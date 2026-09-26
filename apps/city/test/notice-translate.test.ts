import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNoticeTranslatePrompt,
  describeNoticeTranslateFailure,
  parseNoticeTranslateBody,
  parseNoticeTranslateResponse,
  runNoticeTranslate,
} from "../lib/notice-translate.ts";

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

  it("describes busy, timeout, key, and generic translate failures", () => {
    assert.equal(
      describeNoticeTranslateFailure("503 UNAVAILABLE"),
      "Gemini is busy right now. Type the French version to send.",
    );
    assert.equal(
      describeNoticeTranslateFailure("Gemini took longer than 6 seconds"),
      "Gemini did not answer in time. Type the French version to send.",
    );
    assert.equal(
      describeNoticeTranslateFailure("403 permission denied"),
      "Gemini rejected the API key. Type the French version to send.",
    );
    assert.equal(
      describeNoticeTranslateFailure("api key"),
      "Gemini rejected the API key. Type the French version to send.",
    );
    assert.equal(
      describeNoticeTranslateFailure("something else"),
      "Gemini is unavailable. Type the French version to send.",
    );
  });
});

describe("notice translate body validation", () => {
  it("missing en gives 400", async () => {
    for (const raw of [null, {}, { en: "" }, { en: "   " }, { fr: "bonjour" }]) {
      const parsed = parseNoticeTranslateBody(raw);
      assert.equal(parsed.ok, false);
      if (parsed.ok) continue;
      assert.equal(parsed.status, 400);
      assert.equal(parsed.reason, "English text is required");

      let reached = false;
      const result = await runNoticeTranslate(raw, async () => {
        reached = true;
        return { fr: "x", model: "test" };
      });
      assert.equal(reached, false);
      assert.equal(result.status, 400);
      assert.equal(result.body.reason, "English text is required");
    }
  });

  it("valid en reaches the translator", async () => {
    let seen = "";
    const result = await runNoticeTranslate({ en: "  Warming centre open until midnight.  " }, async (en) => {
      seen = en;
      return { fr: "Le centre de réchauffement est ouvert jusqu'à minuit.", model: "test-model" };
    });
    assert.equal(seen, "Warming centre open until midnight.");
    assert.equal(result.status, 200);
    assert.equal(result.body.fr, "Le centre de réchauffement est ouvert jusqu'à minuit.");
    assert.equal(result.body.model, "test-model");
  });
});
