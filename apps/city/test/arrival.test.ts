import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrivalBannerCopy,
  journeyHasHeldHop,
  latestOmwActor,
  selectNewArrivals,
} from "../lib/arrival.ts";

describe("selectNewArrivals", () => {
  it("includes newly seen open and acknowledged incidents, not resolved", () => {
    const known = new Set(["old"]);
    const got = selectNewArrivals(known, [
      { key: "old", household: "a", label: "A", status: "open" },
      { key: "open-1", household: "b", label: "B", status: "open" },
      { key: "ack-1", household: "c", label: "C", status: "acknowledged" },
      { key: "done", household: "d", label: "D", status: "resolved" },
    ]);
    assert.deepEqual(
      got.map((i) => i.key),
      ["open-1", "ack-1"],
    );
  });
});

describe("arrivalBannerCopy", () => {
  it("keeps the open call for help and fall kickers", () => {
    assert.deepEqual(arrivalBannerCopy({ status: "open", fall: false, heldDuringOutage: false, latestOmwLabel: null }), {
      answered: false,
      kicker: "New call for help",
      detail: null,
    });
    assert.equal(arrivalBannerCopy({ status: "open", fall: true, heldDuringOutage: true, latestOmwLabel: null }).kicker, "Possible fall detected");
  });

  it("styles answered arrivals with held or received kickers and an on the way line", () => {
    assert.deepEqual(
      arrivalBannerCopy({ status: "acknowledged", fall: false, heldDuringOutage: true, latestOmwLabel: "19 Oak Terrace" }),
      {
        answered: true,
        kicker: "Held during the outage",
        detail: "19 Oak Terrace is already on the way",
      },
    );
    assert.deepEqual(
      arrivalBannerCopy({ status: "acknowledged", fall: false, heldDuringOutage: false, latestOmwLabel: null }),
      {
        answered: true,
        kicker: "Call received",
        detail: "A neighbour is already on the way",
      },
    );
  });
});

describe("journeyHasHeldHop and latestOmwActor", () => {
  it("detects a held hop at the pause gate", () => {
    assert.equal(journeyHasHeldHop([{ heldMs: 2999 }]), false);
    assert.equal(journeyHasHeldHop([{ heldMs: 3000 }]), true);
  });

  it("picks the latest On my way neighbour", () => {
    assert.equal(latestOmwActor([]), null);
    assert.equal(
      latestOmwActor([
        { actorLabel: "A", replyCode: "cant" },
        { actorLabel: "B", replyCode: "omw" },
        { actorLabel: "C", replyCode: "omw" },
      ]),
      "C",
    );
  });
});
