import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECK_IN_REFUSE_REPLY,
  CHECK_IN_START_REPLY,
  GUIDANCE_BY_NEED,
  GUIDANCE_SKIP_NEEDS,
  VOICE_UNSUITABLE_NOTE,
  guidanceForNeeds,
  startCheckInCopilotDecision,
} from "../lib/needs-guidance.ts";

describe("needs guidance", () => {
  it("returns practical lines for each guidance need, never for lives-alone or age alone", () => {
    const all = guidanceForNeeds([
      "oxygen-concentrator",
      "dialysis-at-home",
      "insulin-refrigeration",
      "mobility-aid",
      "infant",
      "hearing-impaired",
      "lives-alone",
      "age-90-plus",
    ]);
    assert.deepEqual(all.lines, [
      GUIDANCE_BY_NEED["oxygen-concentrator"],
      GUIDANCE_BY_NEED["dialysis-at-home"],
      GUIDANCE_BY_NEED["insulin-refrigeration"],
      GUIDANCE_BY_NEED["mobility-aid"],
      GUIDANCE_BY_NEED.infant,
      GUIDANCE_BY_NEED["hearing-impaired"],
    ]);
    const alone = guidanceForNeeds(["lives-alone", "age-90-plus"]);
    assert.deepEqual(alone.lines, []);
    assert.equal(alone.voiceCallSuitable, true);
    for (const id of GUIDANCE_SKIP_NEEDS) {
      assert.equal(Object.hasOwn(GUIDANCE_BY_NEED, id), false);
    }
  });

  it("marks hard of hearing as unsuitable for a voice call", () => {
    const g = guidanceForNeeds(["hearing-impaired", "lives-alone"]);
    assert.equal(g.voiceCallSuitable, false);
    assert.equal(g.voiceUnsuitableNote, VOICE_UNSUITABLE_NOTE);
    assert.match(g.lines.join(" "), /Knock firmly/);
  });

  it("keeps voice suitable when hearing is fine", () => {
    const g = guidanceForNeeds(["oxygen-concentrator"]);
    assert.equal(g.voiceCallSuitable, true);
    assert.equal(g.voiceUnsuitableNote, null);
  });
});

describe("copilot start_check_in decision", () => {
  it("refuses a voice call for hard of hearing homes", () => {
    const d = startCheckInCopilotDecision(["hearing-impaired"]);
    assert.equal(d.startCall, false);
    assert.equal(d.reply, CHECK_IN_REFUSE_REPLY);
  });

  it("starts a check-in call when a voice call is suitable", () => {
    const d = startCheckInCopilotDecision(["infant"]);
    assert.equal(d.startCall, true);
    assert.equal(d.reply, CHECK_IN_START_REPLY);
  });
});
