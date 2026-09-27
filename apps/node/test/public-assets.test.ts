import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePublicRootFile } from "../src/server";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");

/** Relative ESM imports of the form from "./name.js" (one segment only). */
const RELATIVE_IMPORT = /from\s+["'](\.\/[^"']+)["']/g;

describe("node console public assets", () => {
  it("serves every .js file at the public root", () => {
    const jsFiles = readdirSync(publicDir).filter((f) => f.endsWith(".js") && !f.includes("/"));
    assert.ok(jsFiles.length >= 1, "expected at least one public .js file");
    for (const name of jsFiles) {
      assert.equal(resolvePublicRootFile(`/${name}`), name, `/${name} must match the public root rule`);
      assert.ok(existsSync(join(publicDir, name)), `${name} must exist on disk`);
    }
  });

  it("serves every relative import used by apps/node/public/*.js", () => {
    const jsFiles = readdirSync(publicDir).filter((f) => f.endsWith(".js"));
    const needed = new Set<string>();
    for (const file of jsFiles) {
      const src = readFileSync(join(publicDir, file), "utf8");
      for (const match of src.matchAll(RELATIVE_IMPORT)) {
        const rel = match[1]!;
        assert.ok(rel.startsWith("./"), `${file}: expected relative import, got ${rel}`);
        assert.equal(rel.includes("/", 2), false, `${file}: imports must stay at the public root (no subfolders), got ${rel}`);
        needed.add(rel.slice(2));
      }
    }
    assert.ok(needed.size >= 1, "expected at least one relative import among public .js files");
    for (const name of needed) {
      assert.equal(
        resolvePublicRootFile(`/${name}`),
        name,
        `import of ./${name} would 404: resolvePublicRootFile does not allow it`,
      );
      assert.ok(existsSync(join(publicDir, name)), `import of ./${name} points at a missing file`);
    }
  });

  it("rejects path traversal and subfolders", () => {
    assert.equal(resolvePublicRootFile("/../secret.js"), null);
    assert.equal(resolvePublicRootFile("/foo/bar.js"), null);
    assert.equal(resolvePublicRootFile("/audio/en/x.js"), null);
    assert.equal(resolvePublicRootFile("/styles.css"), "styles.css");
    assert.equal(resolvePublicRootFile("/favicon.svg"), "favicon.svg");
  });
});
