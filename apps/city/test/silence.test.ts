import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSilent, lastHeardAtForSilence, type SilenceHousehold } from "../lib/silence.ts";

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

  it("treats motion, presence and lights_on as heard, but not lights_off", () => {
    const heard = lastHeardAtForSilence([
      { household: "hh-maple-12", kind: "alive", signal: "lights_off", at: 50 * 60_000 },
      { household: "hh-elm-7", kind: "alive", signal: "presence", at: 50 * 60_000 },
    ]);
    const out = computeSilent({
      households: homes,
      lastHeardAt: heard,
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
    });
    assert.ok(out.some((h) => h.household === "hh-maple-12"), "lights_off alone leaves maple silent");
    assert.equal(out.some((h) => h.household === "hh-elm-7"), false, "presence clears elm");
  });

  it("doubles risk when a silent home has power out", () => {
    const withOut = computeSilent({
      households: homes,
      lastHeardAt: {},
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
      powerOut: ["hh-elm-7"],
    });
    // elm risk doubles past maple: maple weight 55*60=3300, elm 15*60*2=1800, still maple first
    assert.equal(withOut[0]!.household, "hh-maple-12");
    assert.equal(withOut.find((h) => h.household === "hh-elm-7")?.powerOut, true);

    const mapleOut = computeSilent({
      households: [
        { id: "hh-a", label: "A", lang: "en", needs: ["lives-alone"] },
        { id: "hh-b", label: "B", lang: "en", needs: ["lives-alone"] },
      ],
      lastHeardAt: {},
      emergencySince: 0,
      now: 60 * 60_000,
      thresholdMinutes: 30,
      powerOut: ["hh-b"],
    });
    assert.deepEqual(
      mapleOut.map((h) => h.household),
      ["hh-b", "hh-a"],
    );
    assert.equal(mapleOut[0]!.powerOut, true);
  });
});
