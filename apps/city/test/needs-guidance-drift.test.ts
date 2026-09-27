import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as city from "../lib/needs-guidance.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeCopyUrl = pathToFileURL(join(root, "apps/node/public/needs-guidance.js")).href;

describe("needs-guidance city and node copies", () => {
  it("keep the same guidance strings and decisions", async () => {
    const node = await import(nodeCopyUrl);
    assert.deepEqual(node.GUIDANCE_NEED_ORDER, [...city.GUIDANCE_NEED_ORDER]);
    assert.deepEqual(node.GUIDANCE_BY_NEED, city.GUIDANCE_BY_NEED);
    assert.deepEqual(node.GUIDANCE_SKIP_NEEDS, [...city.GUIDANCE_SKIP_NEEDS]);
    assert.equal(node.VOICE_UNSUITABLE_NOTE, city.VOICE_UNSUITABLE_NOTE);
    assert.equal(node.CHECK_IN_REFUSE_REPLY, city.CHECK_IN_REFUSE_REPLY);
    assert.equal(node.CHECK_IN_START_REPLY, city.CHECK_IN_START_REPLY);

    const fixtures: string[][] = [
      [],
      ["lives-alone", "age-90-plus"],
      ["hearing-impaired"],
      ["oxygen-concentrator", "infant"],
      ["dialysis-at-home", "mobility-aid", "insulin-refrigeration", "hearing-impaired"],
    ];
    for (const needs of fixtures) {
      assert.deepEqual(node.guidanceForNeeds(needs), city.guidanceForNeeds(needs), needs.join(","));
      assert.deepEqual(node.startCheckInCopilotDecision(needs), city.startCheckInCopilotDecision(needs), needs.join(","));
    }
  });
});
