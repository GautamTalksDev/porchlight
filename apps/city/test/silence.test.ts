import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSilent, type SilenceHousehold } from "../lib/silence.ts";

const homes: SilenceHousehold[] = [
  { id: "hh-maple-12", label: "12 Maple Crescent", lang: "en", needs: ["oxygen-concentrator", "lives-alone"] },
  { id: "hh-cedar-31", label: "31 Cedar Row", lang: "en", needs: [] },
  { id: "hh-elm-7", label: "7 Elm Court", lang: "fr", needs: ["mobility-aid"] },
];

describe("silence is a signal", () => {
  it("flags nobody when no emergency is active", () => {
    assert.deepEqual(
      computeSilent({
        households: homes,
        lastHeardAt: {},
        emergencySince: null,
        now: 1_000_000,
        thresholdMinutes: 30,
      }),
      [],
    );
  });

  it("never flags homes with no recorded needs", () => {
    const out = computeSilent({
      households: homes,
      lastHeardAt: {},
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
    });
    assert.equal(out.some((h) => h.household === "hh-cedar-31"), false);
    assert.ok(out.some((h) => h.household === "hh-maple-12"));
  });

  it("clears a home that had an event after the emergency started", () => {
    const out = computeSilent({
      households: homes,
      lastHeardAt: { "hh-maple-12": 40 * 60_000, "hh-elm-7": null },
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
    });
    assert.equal(out.some((h) => h.household === "hh-maple-12"), false);
    assert.equal(out[0]!.household, "hh-elm-7");
    assert.equal(out[0]!.minutesSilent, 60);
  });

  it("orders by risk: need weight times minutes silent", () => {
    const out = computeSilent({
      households: homes,
      lastHeardAt: {},
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
    });
    assert.deepEqual(
      out.map((h) => h.household),
      ["hh-maple-12", "hh-elm-7"],
    );
  });
});
