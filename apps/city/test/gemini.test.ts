import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availableGeminiModels,
  clearGeminiCooldownForTests,
  DEFAULT_GEMINI_MODELS,
  GEMINI_QUOTA_COOLDOWN_MS,
  geminiQuotaPreflightDetail,
  isGeminiModelCooling,
  isGeminiQuotaError,
  markGeminiQuotaExhausted,
  resolveGeminiModels,
  shouldDeferGeminiTriage,
  shouldReuseTriageCache,
  TRIAGE_GEMINI_MIN_INTERVAL_MS,
} from "../lib/gemini.ts";
import { ruleRanking, type TriageCase } from "../lib/triage-core.ts";

describe("gemini model list", () => {
  it("uses GEMINI_MODELS when set, else legacy pair, else the default list", () => {
    assert.deepEqual(resolveGeminiModels({ GEMINI_MODELS: " a , b, a " }), ["a", "b"]);
    assert.deepEqual(resolveGeminiModels({ GEMINI_MODEL: "gemini-3.6-flash", GEMINI_FALLBACK_MODEL: "gemini-2.5-flash" }), [
      "gemini-3.6-flash",
      "gemini-2.5-flash",
    ]);
    assert.deepEqual(resolveGeminiModels({}), [...DEFAULT_GEMINI_MODELS]);
  });
});

describe("gemini quota cooldown", () => {
  it("skips an exhausted model and expires after 10 minutes", () => {
    clearGeminiCooldownForTests();
    const t0 = 1_000_000;
    const env = { GEMINI_MODELS: "gemini-3.6-flash,gemini-2.5-flash" };

    markGeminiQuotaExhausted("gemini-3.6-flash", t0);
    assert.equal(isGeminiModelCooling("gemini-3.6-flash", t0 + 1), true);
    assert.deepEqual(availableGeminiModels(t0 + 1, env), ["gemini-2.5-flash"]);

    const quota = geminiQuotaPreflightDetail(t0 + 1, env);
    assert.equal(quota.ok, false);
    assert.match(quota.detail, /gemini-3\.6-flash/);
    assert.match(quota.detail, /min left/);

    assert.equal(isGeminiModelCooling("gemini-3.6-flash", t0 + GEMINI_QUOTA_COOLDOWN_MS), false);
    assert.deepEqual(availableGeminiModels(t0 + GEMINI_QUOTA_COOLDOWN_MS, env), ["gemini-3.6-flash", "gemini-2.5-flash"]);
    assert.equal(geminiQuotaPreflightDetail(t0 + GEMINI_QUOTA_COOLDOWN_MS, env).ok, true);

    clearGeminiCooldownForTests();
  });

  it("detects 429 and RESOURCE_EXHAUSTED as quota errors", () => {
    assert.equal(isGeminiQuotaError(Object.assign(new Error("busy"), { status: 429 })), true);
    assert.equal(isGeminiQuotaError(new Error("RESOURCE_EXHAUSTED: free tier")), true);
    assert.equal(isGeminiQuotaError(new Error("Gemini took longer than 6 seconds")), false);
  });
});

describe("triage throttle", () => {
  it("reuses the cached result only when the open-case fingerprint is unchanged", () => {
    const t0 = 50_000;
    assert.equal(
      shouldReuseTriageCache({ key: "same", cachedKey: "same", lastCallAt: t0, now: t0 + 120_000 }),
      true,
    );
    assert.equal(
      shouldReuseTriageCache({
        key: "changed",
        cachedKey: "same",
        lastCallAt: t0,
        now: t0 + TRIAGE_GEMINI_MIN_INTERVAL_MS - 1,
      }),
      false,
    );
    assert.equal(shouldReuseTriageCache({ key: "a", now: t0 }), false);
  });

  it("defers Gemini when cases change inside the interval, without reusing the stale ranking", () => {
    const t0 = 50_000;
    assert.equal(
      shouldDeferGeminiTriage({
        key: "changed",
        cachedKey: "same",
        lastCallAt: t0,
        now: t0 + TRIAGE_GEMINI_MIN_INTERVAL_MS - 1,
      }),
      true,
    );
    assert.equal(
      shouldDeferGeminiTriage({
        key: "changed",
        cachedKey: "same",
        lastCallAt: t0,
        now: t0 + TRIAGE_GEMINI_MIN_INTERVAL_MS,
      }),
      false,
    );
    assert.equal(
      shouldDeferGeminiTriage({
        key: "same",
        cachedKey: "same",
        lastCallAt: t0,
        now: t0 + 1,
      }),
      false,
    );
  });

  it("a new case inside the throttle window appears in the rules catch-up ranking", () => {
    const before: TriageCase[] = [
      { ref: "R1", status: "open", waitMinutes: 5, witnesses: 1, needs: [], lang: "en" },
    ];
    const after: TriageCase[] = [
      ...before,
      {
        ref: "R2",
        status: "open",
        waitMinutes: 1,
        witnesses: 1,
        needs: [{ id: "oxygen-concentrator", weight: 40 }],
        lang: "en",
      },
    ];
    const t0 = 10_000;
    assert.equal(
      shouldDeferGeminiTriage({
        key: "after",
        cachedKey: "before",
        lastCallAt: t0,
        now: t0 + 5_000,
      }),
      true,
    );
    // While Gemini is deferred, the queue must be a rules ranking of CURRENT cases.
    const ranked = ruleRanking(after);
    assert.equal(ranked.length, 2);
    assert.equal(
      ranked.some((r) => r.ref === "R2"),
      true,
    );
    assert.equal(
      ranked.some((r) => r.ref === "R1"),
      true,
    );
  });
});
