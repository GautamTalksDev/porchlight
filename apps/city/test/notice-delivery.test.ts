import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noticeReachStats, recordNoticeConfirmations } from "../lib/notice-delivery.ts";

describe("notice delivery counting", () => {
  it("counts distinct nodes per notice and ignores unknown ids", () => {
    const conf = new Map<string, Set<string>>();
    const known = new Set(["n1", "n2"]);
    recordNoticeConfirmations(conf, "node-a", ["n1", "bogus"], known);
    recordNoticeConfirmations(conf, "node-b", ["n1", "n2"], known);
    recordNoticeConfirmations(conf, "node-a", ["n1"], known);
    const rows = noticeReachStats(["n1", "n2", "n3"], conf, 3);
    assert.deepEqual(rows, [
      { noticeId: "n1", reachedNodes: 2, totalNodes: 3 },
      { noticeId: "n2", reachedNodes: 1, totalNodes: 3 },
      { noticeId: "n3", reachedNodes: 0, totalNodes: 3 },
    ]);
  });
});
