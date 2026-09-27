import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("porch circles buddies", () => {
  it("keeps households.json and city-registry.json buddies in agreement", () => {
    const street = JSON.parse(readFileSync(join(root, "config/households.json"), "utf8")) as {
      households: Record<string, { buddies?: string[] }>;
    };
    const city = JSON.parse(readFileSync(join(root, "config/city-registry.json"), "utf8")) as {
      households: Record<string, { needs?: string[]; buddies?: string[] }>;
    };
    const ids = new Set([...Object.keys(street.households), ...Object.keys(city.households)]);
    for (const id of ids) {
      const a = [...(street.households[id]?.buddies ?? [])].sort();
      const b = [...(city.households[id]?.buddies ?? [])].sort();
      assert.deepEqual(a, b, `${id} buddies differ between households.json and city-registry.json`);
      const streetNeeds = [...((street.households[id] as { needs?: string[] } | undefined)?.needs ?? [])].sort();
      const cityNeeds = [...(city.households[id]?.needs ?? [])].sort();
      assert.deepEqual(streetNeeds, cityNeeds, `${id} needs differ between households.json and city-registry.json`);
    }
    assert.deepEqual(city.households["hh-maple-12"]!.buddies, ["hh-oak-19", "hh-birch-4"]);
    for (const [id, h] of Object.entries(city.households)) {
      if ((h.needs?.length ?? 0) > 0) {
        assert.equal(h.buddies?.length, 2, `${id} has needs so it needs exactly two buddies`);
      } else {
        assert.equal(h.buddies?.length ?? 0, 0, `${id} has no needs so it should have no buddies`);
      }
    }
  });
});
