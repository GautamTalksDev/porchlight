import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HybridClock, createEvent, generateIdentity } from "@porchlight/protocol";
import { classifyIngestItem } from "../lib/ingest-verify.ts";

describe("ingest accepts reply events", () => {
  it("classifies a signed neighbour reply as accepted", () => {
    const me = generateIdentity();
    const clock = new HybridClock(me.id);
    const help = createEvent(me, clock, {
      kind: "help",
      household: "hh-maple-12",
      incident: "pl-b01:0000abcd:1",
      source: { type: "console" },
    });
    const reply = createEvent(me, clock, {
      kind: "reply",
      household: "hh-maple-12",
      incident: help.incident,
      ref: help.id,
      actor: "hh-birch-4",
      reply: "omw",
      source: { type: "console" },
    });
    const verdict = classifyIngestItem(reply, () => false);
    assert.equal(verdict.status, "accepted");
    if (verdict.status === "accepted") {
      assert.equal(verdict.event.kind, "reply");
      assert.equal(verdict.event.reply, "omw");
      assert.equal(verdict.event.actor, "hh-birch-4");
    }
  });

  it("does not reject reply for being an unknown kind", () => {
    const me = generateIdentity();
    const clock = new HybridClock(me.id);
    const reply = createEvent(me, clock, {
      kind: "reply",
      household: "hh-pine-2",
      incident: "pl-b02:0000ffff:2",
      ref: "a".repeat(64),
      actor: "hh-elm-7",
      reply: "generator",
      note: "spare fuel in the shed",
      source: { type: "console" },
    });
    const verdict = classifyIngestItem(reply, () => false);
    assert.equal(verdict.status, "accepted");
  });
});
