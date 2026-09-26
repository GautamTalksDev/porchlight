import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Applies db/schema.sql statement by statement. Safe to run repeatedly. */
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", "..", "..", ".env");
try {
  process.loadEnvFile(envPath);
} catch {
  /* no .env file; use the shell environment */
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add your Tiger Data connection string to .env first.");
  process.exit(1);
}

const sql = readFileSync(join(here, "..", "db", "schema.sql"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const statements = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let skipped = 0;
for (const stmt of statements) {
  const first = stmt.split("\n")[0]!.slice(0, 70);
  try {
    await client.query(stmt);
    console.log(`ok       ${first}`);
  } catch (err) {
    const msg = (err as Error).message;
    const timescaleOnly = /timescaledb|hypertable|time_bucket|continuous|compress|by_range/i.test(stmt);
    if (timescaleOnly) {
      skipped++;
      console.warn(`skipped  ${first}\n         ${msg}`);
    } else {
      console.error(`failed   ${first}\n         ${msg}`);
      await client.end();
      process.exit(1);
    }
  }
}
await client.end();
console.log(skipped ? `\nDone, with ${skipped} TimescaleDB features skipped. Use a Tiger Data service to enable them.` : "\nDone. Tiger Data schema is ready.");
