import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventStore, HybridClock, generateIdentity, isStreetHousehold } from "@porchlight/protocol";
import {
  cityEventsDownlink,
  createCityEventStore,
  noticesFromEvents,
  storeSignedNotice,
} from "../lib/city-notices.ts";
import { classifyIngestItem } from "../lib/ingest-verify.ts";
import { withoutBroadcastHousehold } from "../lib/street-households.ts";

describe("city notice broadcast", () => {
  it("stores a notice so the snapshot list and ingest cityEvents both include it", () => {
    const identity = generateIdentity();
    const clock = new HybridClock(identity.id);
    const store = createCityEventStore(identity.id);
    const confirmations = new Map<string, Set<string>>();

    const ev = storeSignedNotice(store, identity, clock, {
      en: "Warming centre at Heron Road is open until midnight.",
      fr: "Le centre de réchauffement sur le chemin Heron est ouvert jusqu'à minuit.",
      severity: "info",
    });

    assert.equal(store.has(ev.id), true);
    assert.equal(isStreetHousehold(ev.household), false);

    const notices = noticesFromEvents(store.all(), identity.id, confirmations, 3);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.id, ev.id);
    assert.match(notices[0]!.en, /Heron Road/);
    assert.equal(notices[0]!.reachedNodes, 0);
    assert.equal(notices[0]!.totalNodes, 3);

    const homes = withoutBroadcastHousehold([{ id: ev.household, label: "City Hall" }, { id: "hh-maple-12", label: "12 Maple" }]);
    assert.deepEqual(
      homes.map((h) => h.id),
      ["hh-maple-12"],
    );

    const cityEvents = cityEventsDownlink(store.all(), identity.id);
    assert.equal(cityEvents.some((e) => e.id === ev.id && e.kind === "notice"), true);

    const ingestShape = {
      accepted: [] as string[],
      duplicates: [] as string[],
      rejected: [] as { id: string; reason: string }[],
      cityEvents,
      cityId: identity.id,
    };
    assert.equal(ingestShape.cityEvents.length, 1);
    assert.equal(ingestShape.cityEvents[0]!.kind, "notice");
  });

  it("rejects a notice when the store has no cityOrigin pinned", () => {
    const identity = generateIdentity();
    const clock = new HybridClock(identity.id);
    const bare = new EventStore();
    assert.throws(
      () =>
        storeSignedNotice(bare, identity, clock, {
          en: "Shelter open.",
          fr: "Refuge ouvert.",
          severity: "urgent",
        }),
      /could not store notice/,
    );
  });

  it("accepts a city-signed notice on ingest when cityOrigin is passed", () => {
    const identity = generateIdentity();
    const clock = new HybridClock(identity.id);
    const store = createCityEventStore(identity.id);
    const ev = storeSignedNotice(store, identity, clock, {
      en: "Boil water advisory for ward 12.",
      fr: "Avis d'ébullition de l'eau pour le quartier 12.",
      severity: "urgent",
    });
    const verdict = classifyIngestItem(ev, () => false, { cityOrigin: identity.id });
    assert.equal(verdict.status, "accepted");
    const rejected = classifyIngestItem(ev, () => false);
    assert.equal(rejected.status, "rejected");
  });
});
