// Starts the production build with the repository's .env loaded. Used by `npm run city:start`.
import { existsSync } from "node:fs";
import { join } from "node:path";

const envFile = join("..", "..", ".env");
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}
process.env.PORT ??= "3000";
process.env.HOSTNAME ??= "0.0.0.0";
await import(join(process.cwd(), ".next", "standalone", "apps", "city", "server.js"));
