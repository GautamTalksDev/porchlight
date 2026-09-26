import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CITY_BROADCAST_HOUSEHOLD, isStreetHousehold } from "@porchlight/protocol";
import { withoutBroadcastHousehold } from "../lib/street-households.ts";

describe("city-hall stays off the street", () => {
  it("treats city-hall as a broadcast slug, not a home", () => {
    assert.equal(isStreetHousehold(CITY_BROADCAST_HOUSEHOLD), false);
    assert.equal(isStreetHousehold("hh-maple-12"), true);
  });

  it("strips city-hall from household lists used by the ops room and console", () => {
    const homes = withoutBroadcastHousehold([
      { id: "hh-maple-12", label: "12 Maple Crescent" },
      { id: CITY_BROADCAST_HOUSEHOLD, label: "City Hall" },
      { household: "hh-oak-19" },
      { household: CITY_BROADCAST_HOUSEHOLD },
    ]);
    assert.deepEqual(
      homes.map((h) => h.id ?? h.household),
      ["hh-maple-12", "hh-oak-19"],
    );
  });
});
