/**
 * Clears demo node event logs and delivery state, keeping identity keys so node ids stay stable.
 * Refuses to run while the demo node ports are in use.
 *
 * Usage: npm run demo:reset
 */
import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const PORTS = [7401, 7402, 7403];
const NAMES = ["node-a", "node-b", "node-c"] as const;
const base = process.env.DEMO_DATA_DIR ?? join(".", "data", "demo");

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

function removeIfPresent(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

for (const port of PORTS) {
  if (await portInUse(port)) {
    console.error("Stop the nodes first (Ctrl+C), then run npm run demo:reset.");
    process.exit(1);
  }
}

console.log(`Demo data: ${base}`);
for (const name of NAMES) {
  const dir = join(base, name);
  const cleared: string[] = [];
  if (removeIfPresent(join(dir, "events.jsonl"))) cleared.push("events.jsonl");
  if (removeIfPresent(join(dir, "uplinked.json"))) cleared.push("uplinked.json");
  const keptId = existsSync(join(dir, "identity.json")) ? "identity.json kept" : "no identity yet";
  const keptCity = existsSync(join(dir, "city-id.json")) ? "city-id.json kept" : "no city id yet";
  if (cleared.length) {
    console.log(`${name}: cleared ${cleared.join(", ")}; ${keptId}; ${keptCity}`);
  } else {
    console.log(`${name}: nothing to clear; ${keptId}; ${keptCity}`);
  }
}
console.log("Done. Start the nodes with npm run demo:local.");
