import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePowerOut,
  formatLatestSignOfLife,
  formatSignsOfLifeLine,
  latestLightState,
  powerOutTriageBoost,
  signsOfLifeFromEvents,
} from "../lib/power.ts";
import { lastHeardAtForSilence } from "../lib/silence.ts";

describe("light state", () => {
  it("tracks the latest lights_on or lights_off per home", () => {
    const state = latestLightState([
      { household: "hh-a", signal: "lights_on", at: 100 },
      { household: "hh-a", signal: "lights_off", at: 200 },
      { household: "hh-b", signal: "motion", at: 300 },
      { household: "hh-b", signal: "lights_on", at: 150 },
    ]);
    assert.equal(state["hh-a"], "off");
    assert.equal(state["hh-b"], "on");
  });
});

describe("power out", () => {
  const homes = [
    { id: "hh-maple-12", needs: ["oxygen-concentrator", "lives-alone"] },
    { id: "hh-elm-7", needs: ["mobility-aid"] },
    { id: "hh-pine-2", needs: ["insulin-refrigeration"] },
  ];

  it("flags power-dependent homes with lights off only during an emergency", () => {
    const lightState = { "hh-maple-12": "off" as const, "hh-pine-2": "off" as const, "hh-elm-7": "off" as const };
    assert.deepEqual(computePowerOut({ households: homes, lightState, emergencyActive: false }), []);
    assert.deepEqual(computePowerOut({ households: homes, lightState, emergencyActive: true }), [
      "hh-maple-12",
      "hh-pine-2",
    ]);
  });

  it("clears when lights come back on", () => {
    assert.deepEqual(
      computePowerOut({
        households: homes,
        lightState: { "hh-maple-12": "on" },
        emergencyActive: true,
      }),
      [],
    );
  });
});

describe("triage power boost", () => {
  it("adds +10 and a reason when power is out at a dependent home", () => {
    const hit = powerOutTriageBoost(["oxygen-concentrator"], true);
    assert.equal(hit.boost, 10);
    assert.equal(hit.reason, "power out at a home with oxygen concentrator");
    assert.deepEqual(powerOutTriageBoost(["oxygen-concentrator"], false), { boost: 0, reason: null });
    assert.deepEqual(powerOutTriageBoost(["lives-alone"], true), { boost: 0, reason: null });
  });
});

describe("signs of life copy", () => {
  it("builds a detail line from the signals that exist", () => {
    const now = 60_000;
    const line = formatSignsOfLifeLine(
      { motion: now - 12_000, presence: now - 3 * 60_000, lights_on: now - 1000 },
      now,
    );
    assert.equal(line, "Moved 12 s ago. Someone seen 3 min ago. Lights on.");
  });

  it("picks the latest phrase for the street card", () => {
    const now = 10_000;
    assert.equal(
      formatLatestSignOfLife({ motion: 1000, lights_off: 5000 }, now),
      "Lights out",
    );
  });

  it("folds events into per-home sign timestamps", () => {
    const signs = signsOfLifeFromEvents([
      { household: "hh-a", kind: "alive", signal: "motion", at: 1 },
      { household: "hh-a", kind: "alive", signal: "motion", at: 5 },
      { household: "hh-a", kind: "help", at: 9 },
    ]);
    assert.equal(signs["hh-a"]!.motion, 5);
  });
});

describe("heard for silence", () => {
  it("counts motion and ignores lights_off", () => {
    const heard = lastHeardAtForSilence([
      { household: "hh-a", kind: "alive", signal: "lights_off", at: 500 },
      { household: "hh-a", kind: "alive", signal: "motion", at: 100 },
      { household: "hh-b", kind: "alive", signal: "lights_on", at: 200 },
    ]);
    assert.equal(heard["hh-a"], 100);
    assert.equal(heard["hh-b"], 200);
  });
});
