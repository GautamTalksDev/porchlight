import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads the repository's .env file if there is one. Values already set in the shell win. */
const path = resolve(process.cwd(), ".env");
if (existsSync(path)) {
  const before = { ...process.env };
  process.loadEnvFile(path);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}
