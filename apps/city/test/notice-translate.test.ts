import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNoticeTranslatePrompt, parseNoticeTranslateResponse } from "../lib/notice-translate.ts";

describe("notice translate helpers", () => {
  it("builds a prompt that includes the English text", () => {
    const p = buildNoticeTranslatePrompt("Shelter at 12 Maple Crescent opens at 18:00.");
    assert.match(p, /Canadian French/);
    assert.match(p, /12 Maple Crescent/);
    assert.match(p, /18:00/);
  });

  it("parses a clean French response and rejects empty or over-long text", () => {
    assert.equal(parseNoticeTranslateResponse("  Refuge ouvert.  "), "Refuge ouvert.");
    assert.throws(() => parseNoticeTranslateResponse("   "), /empty/);
    assert.throws(() => parseNoticeTranslateResponse("x".repeat(321)), /too long/);
  });
});
