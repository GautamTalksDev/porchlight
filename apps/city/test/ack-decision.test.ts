import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAck, VOICE_ESCALATION_NOTE } from "../lib/ack-decision.ts";

describe("city ack decision", () => {
  it("acknowledges every open call at the home", () => {
    const d = decideAck(
      [
        { household: "h1", status: "open", eventId: "a".repeat(64) },
        { household: "h1", status: "open", eventId: "b".repeat(64) },
        { household: "h2", status: "open", eventId: "c".repeat(64) },
      ],
      "h1",
    );
    assert.deepEqual(d, { action: "ack", eventIds: ["a".repeat(64), "b".repeat(64)] });
  });

  it("returns already when help is on the way and nothing is open", () => {
    const d = decideAck([{ household: "h1", status: "acknowledged", eventId: "a".repeat(64) }], "h1");
    assert.deepEqual(d, { action: "already" });
  });

  it("escalates when the resident is not safe and there is no open or acknowledged call", () => {
    const d = decideAck(
      [
        { household: "h1", status: "resolved", eventId: "a".repeat(64) },
        { household: "h2", status: "open", eventId: "b".repeat(64) },
      ],
      "h1",
    );
    assert.deepEqual(d, { action: "escalate" });
    assert.equal(VOICE_ESCALATION_NOTE, "Requested during a voice check-in");
  });
});
