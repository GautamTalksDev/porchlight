import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildJourney,
  formatJourneyBreadcrumb,
  journeyFromTrail,
  resolveNodeHouseholds,
  CITY_HALL_ID,
} from "../lib/journey.ts";

const labels = {
  "hh-maple-12": "12 Maple Crescent",
  "hh-oak-19": "19 Oak Terrace",
  "hh-cedar-31": "31 Cedar Row",
};

const homes = {
  "node-a": "hh-maple-12",
  "node-b": "hh-oak-19",
  "node-c": "hh-cedar-31",
};

describe("buildJourney", () => {
  it("builds a direct delivery from the calling home to City Hall", () => {
    const hops = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "node-a",
      deliveredBy: "node-a",
      heldMs: 0,
      nodeHouseholds: homes,
      householdLabels: labels,
    });
    assert.equal(hops.length, 1);
    assert.equal(hops[0]!.kind, "To City Hall");
    assert.equal(hops[0]!.fromId, "hh-maple-12");
    assert.equal(hops[0]!.toId, CITY_HALL_ID);
    assert.equal(hops[0]!.heldMs, undefined);
  });

  it("builds a relayed delivery with Bluetooth and neighbour hops", () => {
    const hops = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "node-b",
      deliveredBy: "node-c",
      heldMs: 0,
      nodeHouseholds: homes,
      householdLabels: labels,
    });
    assert.deepEqual(
      hops.map((h) => h.kind),
      ["Bluetooth", "Neighbour to neighbour", "To City Hall"],
    );
    assert.equal(hops[0]!.fromId, "hh-maple-12");
    assert.equal(hops[0]!.toId, "hh-oak-19");
    assert.equal(hops[1]!.fromId, "hh-oak-19");
    assert.equal(hops[1]!.toId, "hh-cedar-31");
    assert.equal(hops[2]!.fromId, "hh-cedar-31");
    assert.equal(hops[2]!.toId, CITY_HALL_ID);
    assert.equal(
      formatJourneyBreadcrumb(hops),
      "12 Maple Crescent, Bluetooth, 19 Oak Terrace, neighbour to neighbour, 31 Cedar Row, To City Hall",
    );
  });

  it("attaches held time to the last street hop on a held delivery", () => {
    const hops = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "node-b",
      deliveredBy: "node-c",
      heldMs: 45_000,
      nodeHouseholds: homes,
      householdLabels: labels,
    });
    assert.equal(hops[0]!.heldMs, undefined);
    assert.equal(hops[1]!.heldMs, 45_000);
    assert.equal(hops[2]!.heldMs, undefined);
    assert.match(formatJourneyBreadcrumb(hops), /held 45 s during the outage/);
  });

  it("ignores holds under 3000 ms so the pulse flows straight through", () => {
    const brief = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "node-b",
      deliveredBy: "node-c",
      heldMs: 2999,
      nodeHouseholds: homes,
      householdLabels: labels,
    });
    assert.equal(
      brief.every((h) => h.heldMs === undefined),
      true,
    );
    assert.equal(
      formatJourneyBreadcrumb(brief).includes("held"),
      false,
    );
    const atGate = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "node-b",
      deliveredBy: "node-c",
      heldMs: 3000,
      nodeHouseholds: homes,
      householdLabels: labels,
    });
    assert.equal(atGate[1]!.heldMs, 3000);
    assert.match(formatJourneyBreadcrumb(atGate), /held 3 s during the outage/);
  });

  it("skips hops for unknown node households and never crashes", () => {
    const hops = buildJourney({
      event: { household: "hh-maple-12", source: { type: "beacon" } },
      householdLabel: "12 Maple Crescent",
      originNode: "ghost-node",
      deliveredBy: "node-c",
      heldMs: 12_000,
      nodeHouseholds: { "node-c": "hh-cedar-31" },
      householdLabels: labels,
    });
    assert.equal(
      hops.some((h) => h.kind === "Bluetooth"),
      false,
    );
    assert.equal(
      hops.some((h) => h.kind === "Neighbour to neighbour"),
      true,
    );
    assert.equal(hops.at(-1)!.kind, "To City Hall");
    assert.equal(hops.at(-1)!.fromId, "hh-cedar-31");
    const empty = buildJourney({
      event: { household: "hh-maple-12", source: { type: "console" } },
      householdLabel: "12 Maple Crescent",
      originNode: null,
      deliveredBy: null,
      nodeHouseholds: {},
      householdLabels: labels,
    });
    assert.equal(empty.length, 1);
    assert.equal(empty[0]!.kind, "To City Hall");
  });
});

describe("journey from ingest snapshot", () => {
  it("builds calling home, Bluetooth, node home, To City Hall when ingest includes the node household", () => {
    // Mirrors city after ingest({ name: "node-a", household: "hh-oak-19" }, [beacon help for maple]).
    const registryNodes = {
      "node-a": "hh-oak-19",
      "node-b": "hh-birch-4",
      "node-c": "hh-cedar-31",
    };
    const nodeHouseholds = resolveNodeHouseholds({
      registryNodes,
      liveNodes: [{ name: "node-a", household: "hh-oak-19" }],
    });
    assert.equal(nodeHouseholds["node-a"], "hh-oak-19");

    const trail = [
      {
        kind: "help",
        by: "node-a",
        via: "node-a",
        source: "beacon",
        heldMs: 400,
      },
    ];
    const hops = journeyFromTrail({
      householdId: "hh-maple-12",
      householdLabel: "12 Maple Crescent",
      trail,
      nodeHouseholds,
      householdLabels: labels,
      nodes: [{ id: "aaaaaaaaaaaaaaaa", name: "node-a" }],
      hasOpenCall: true,
    });

    assert.deepEqual(
      hops.map((h) => h.kind),
      ["Bluetooth", "To City Hall"],
    );
    assert.equal(hops[0]!.fromId, "hh-maple-12");
    assert.equal(hops[0]!.fromLabel, "12 Maple Crescent");
    assert.equal(hops[0]!.toId, "hh-oak-19");
    assert.equal(hops[0]!.toLabel, "19 Oak Terrace");
    assert.equal(hops[1]!.fromId, "hh-oak-19");
    assert.equal(hops[1]!.kind, "To City Hall");
    assert.equal(hops[1]!.toId, CITY_HALL_ID);
    assert.equal(
      formatJourneyBreadcrumb(hops),
      "12 Maple Crescent, Bluetooth, 19 Oak Terrace, To City Hall",
    );
  });
});
