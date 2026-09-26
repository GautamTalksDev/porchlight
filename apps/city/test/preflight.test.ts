import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePreflight, type PreflightCheck } from "../lib/preflight.ts";

describe("summarizePreflight", () => {
  it("is green only when every check passes", () => {
    const allOk: PreflightCheck[] = [
      { name: "database", ok: true, detail: "memory mode" },
      { name: "Gemini", ok: true, detail: "key present" },
    ];
    assert.deepEqual(summarizePreflight(allOk), { ok: true, passed: 2, total: 2 });
  });

  it("is red when any check fails", () => {
    const mixed: PreflightCheck[] = [
      { name: "database", ok: true, detail: "ok" },
      { name: "nodes", ok: false, detail: "0 reporting" },
    ];
    assert.deepEqual(summarizePreflight(mixed), { ok: false, passed: 1, total: 2 });
  });

  it("is red for an empty list", () => {
    assert.deepEqual(summarizePreflight([]), { ok: false, passed: 0, total: 0 });
  });
});
