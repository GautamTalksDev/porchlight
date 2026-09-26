// Runs after `next build`: the standalone server needs static assets and public files next to it.
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const target = join(".next", "standalone", "apps", "city");
if (existsSync(target)) {
  cpSync(join(".next", "static"), join(target, ".next", "static"), { recursive: true });
  cpSync("public", join(target, "public"), { recursive: true });
  console.log("Standalone server ready: npm run city:start");
}
