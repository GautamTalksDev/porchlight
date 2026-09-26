import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYTICS_COOLDOWN_MS, shouldSkipAnalytics } from "../lib/analytics-backoff.ts";

describe("analytics backoff", () => {
  it("does not skip when nothing has failed", () => {
    assert.equal(shouldSkipAnalytics(null, 1_000_000), false);
  });

  it("skips for 30 seconds after a failure, then allows again", () => {
    const failedAt = 1_000_000;
    assert.equal(shouldSkipAnalytics(failedAt, failedAt + 1_000), true);
    assert.equal(shouldSkipAnalytics(failedAt, failedAt + ANALYTICS_COOLDOWN_MS - 1), true);
    assert.equal(shouldSkipAnalytics(failedAt, failedAt + ANALYTICS_COOLDOWN_MS), false);
    assert.equal(shouldSkipAnalytics(failedAt, failedAt + ANALYTICS_COOLDOWN_MS + 5_000), false);
  });
});
