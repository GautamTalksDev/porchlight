import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FALL_NOTE as PROTOCOL_FALL_NOTE, aliveTrailLabel as protocolAliveTrailLabel } from "@porchlight/protocol";
import { FALL_NOTE as CITY_FALL_NOTE } from "../lib/fall.ts";
import { aliveTrailLabel as cityAliveTrailLabel } from "../lib/power.ts";

const SIGNALS = ["motion", "presence", "lights_on", "lights_off"] as const;

describe("city copies of protocol labels", () => {
  it("keeps alive trail labels identical for every signal", () => {
    for (const signal of SIGNALS) {
      assert.equal(cityAliveTrailLabel(signal), protocolAliveTrailLabel(signal), signal);
    }
    assert.equal(cityAliveTrailLabel(undefined), protocolAliveTrailLabel(undefined));
    assert.equal(cityAliveTrailLabel("other"), protocolAliveTrailLabel("other"));
  });

  it("keeps the fall note identical to the protocol export", () => {
    assert.equal(CITY_FALL_NOTE, PROTOCOL_FALL_NOTE);
  });
});
