import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const mod = await import(pathToFileURL(join(root, "apps/node/public/street-status.js")).href);

describe("houseStatusParts", () => {
  it("shows status first and sign of life after it", () => {
    const p = mod.houseStatusParts({
      label: "12 Maple Crescent",
      statusText: "Help on the way",
      signOfLife: "Lights on",
    });
    assert.equal(p.primary, "Help on the way");
    assert.equal(p.secondary, "Lights on");
    assert.equal(p.aria, "12 Maple Crescent: Help on the way. Lights on");
  });

  it("omits the quieter line when there is no sign of life", () => {
    const p = mod.houseStatusParts({ label: "4 Birch Lane", statusText: "Safe", signOfLife: null });
    assert.equal(p.primary, "Safe");
    assert.equal(p.secondary, null);
    assert.equal(p.aria, "4 Birch Lane: Safe");
  });
});
