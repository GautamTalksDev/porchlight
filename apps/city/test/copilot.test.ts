import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOverview, normalizeSpoken, resolveHousehold } from "../lib/copilot.ts";

const homes = [
  { id: "hh-maple-12", label: "12 Maple Crescent" },
  { id: "hh-birch-4", label: "4 Birch Lane" },
  { id: "hh-cedar-31", label: "31 Cedar Row" },
  { id: "hh-elm-7", label: "7 Elm Court" },
  { id: "hh-pine-2", label: "2 Pine Walk" },
];

describe("resolveHousehold", () => {
  it("matches street name alone", () => {
    assert.deepEqual(resolveHousehold("Maple", homes), { id: "hh-maple-12", label: "12 Maple Crescent" });
    assert.deepEqual(resolveHousehold("Pine Walk", homes), { id: "hh-pine-2", label: "2 Pine Walk" });
  });

  it("matches digits and spelled-out numbers", () => {
    assert.deepEqual(resolveHousehold("12 maple", homes), { id: "hh-maple-12", label: "12 Maple Crescent" });
    assert.deepEqual(resolveHousehold("twelve Maple Crescent", homes), {
      id: "hh-maple-12",
      label: "12 Maple Crescent",
    });
    assert.equal(normalizeSpoken("thirty one Cedar Row"), "31 cedar row");
    assert.deepEqual(resolveHousehold("thirty one Cedar Row", homes), {
      id: "hh-cedar-31",
      label: "31 Cedar Row",
    });
  });

  it("returns null for a street that is not on the map", () => {
    assert.equal(resolveHousehold("Baker Street", homes), null);
    assert.equal(resolveHousehold("", homes), null);
  });
});

describe("buildOverview", () => {
  it("names the top-ranked call first and stays under 80 words", () => {
    const text = buildOverview({
      counts: { help: 2, acknowledged: 0, ok: 3, unknown: 1 },
      queue: [
        { label: "12 Maple Crescent", needs: ["oxygen concentrator", "lives alone"] },
        { label: "2 Pine Walk", needs: ["dialysis at home"] },
      ],
      silent: [{ label: "7 Elm Court", minutesSilent: 45 }],
      outage: false,
      emergencySince: 1,
      nodesReporting: 3,
      nodesTotal: 3,
    });
    assert.match(text, /^.*12 Maple Crescent/s);
    const mapleAt = text.indexOf("12 Maple Crescent");
    const pineAt = text.indexOf("2 Pine Walk");
    assert.ok(mapleAt >= 0 && pineAt > mapleAt, "top-ranked call should be named before the next");
    assert.ok(text.split(/\s+/).filter(Boolean).length <= 80);
    assert.match(text, /oxygen concentrator/);
    assert.match(text, /Emergency is active/);
  });

  it("handles a quiet street", () => {
    const text = buildOverview({
      counts: { help: 0, acknowledged: 0, ok: 5, unknown: 3 },
      queue: [],
      silent: [],
      outage: true,
      emergencySince: null,
      nodesReporting: 2,
      nodesTotal: 3,
    });
    assert.match(text, /No open calls/);
    assert.match(text, /City link is down/);
  });
});
