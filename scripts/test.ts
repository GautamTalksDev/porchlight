/**
 * Runs every test file in one process so the TypeScript loader applies to all of them.
 * Usage: npm test            (all suites)
 *        npm test protocol   (only files whose path contains "protocol")
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const roots = ["packages", "apps"];
const filter = process.argv[2];
const files: string[] = [];

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.test\.ts$/.test(name) && (!filter || p.includes(filter))) files.push(p);
  }
}
for (const r of roots) walk(r);

let failed = 0;
const stream = run({ files, isolation: "none", concurrency: false });
stream.on("test:fail", () => failed++);
stream.compose(spec).pipe(process.stdout);
stream.on("end", () => {
  if (failed) process.exitCode = 1;
});
