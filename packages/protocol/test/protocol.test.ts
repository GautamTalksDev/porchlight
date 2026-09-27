import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BeaconGuard,
  EventStore,
  HybridClock,
  JsonlFileAdapter,
  bytesToHex,
  canonicalize,
  createEvent,
  decodeFrame,
  deserializeIdentity,
  encodeFrame,
  escalationTier,
  generateIdentity,
  handleExchange,
  handlePull,
  handlePush,
  hexToBytes,
  project,
  serializeIdentity,
  siphash24,
  syncWith,
  verifyEvent,
  type SyncTransport,
} from "../src/index";

const key16 = Uint8Array.from({ length: 16 }, (_, i) => i);

describe("siphash24", () => {
  it("matches the reference vectors from the SipHash paper", () => {
    assert.equal(bytesToHex(siphash24(key16, new Uint8Array(0))), "310e0edd47db6f72");
    const msg15 = Uint8Array.from({ length: 15 }, (_, i) => i);
    // reference output 0xa129ca6149be45e5, little-endian bytes
    assert.equal(bytesToHex(siphash24(key16, msg15)), "e545be4961ca29a1");
  });
});

describe("canonicalize", () => {
  it("is independent of key order", () => {
    assert.equal(canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }), canonicalize({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });
  it("drops undefined fields", () => {
    assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
  });
});

describe("identity", () => {
  it("round-trips through serialization", () => {
    const a = generateIdentity();
    const b = deserializeIdentity(serializeIdentity(a));
    assert.equal(a.id, b.id);
    assert.equal(a.pub, b.pub);
  });
});

describe("events", () => {
  const me = generateIdentity();
  const clock = new HybridClock(me.id);
  const help = createEvent(me, clock, { kind: "help", household: "hh-maple-12", incident: "pl-b01:0000abcd:1", source: { type: "console" } });

  it("verifies a genuine event", () => {
    assert.equal(verifyEvent(help).ok, true);
  });
  it("rejects a tampered body", () => {
    const r = verifyEvent({ ...help, household: "hh-other" });
    assert.equal(r.ok, false);
  });
  it("rejects a forged origin", () => {
    const other = generateIdentity();
    const r = verifyEvent({ ...help, origin: other.id });
    assert.equal(r.ok, false);
  });
  it("rejects a re-signed event claiming someone else's key", () => {
    const attacker = generateIdentity();
    const forged = createEvent(attacker, new HybridClock(attacker.id), { kind: "help", household: "hh-maple-12", incident: "x:0:1", source: { type: "console" } });
    const r = verifyEvent({ ...forged, pub: me.pub });
    assert.equal(r.ok, false);
  });
  it("rejects control characters in notes", () => {
    assert.throws(() => createEvent(me, clock, { kind: "note", household: "hh-maple-12", note: "hi\u001b[31m", source: { type: "console" } }));
  });
  it("enforces the roster when configured", () => {
    const r = verifyEvent(help, { allowedOrigins: new Set(["0000000000000000"]) });
    assert.equal(r.ok, false);
  });
  it("rejects events from the far future", () => {
    const skewed = new HybridClock(me.id, () => Date.now() + 60 * 60 * 1000);
    const ev = createEvent(me, skewed, { kind: "ok", household: "hh-maple-12", source: { type: "console" } });
    assert.equal(verifyEvent(ev).ok, false);
  });
});

describe("store + sync", () => {
  function memPeer(store: EventStore, id: string, dropRate = 0): SyncTransport {
    const maybeDrop = () => {
      if (Math.random() < dropRate) throw new Error("dropped");
    };
    return {
      async exchange(req) { maybeDrop(); return handleExchange(store, id, req); },
      async push(req) { maybeDrop(); return handlePush(store, req); },
      async pull(req) { maybeDrop(); return handlePull(store, req); },
    };
  }

  it("converges two stores to identical digests", async () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const sa = new EventStore();
    const sb = new EventStore();
    const ca = new HybridClock(a.id);
    const cb = new HybridClock(b.id);
    for (let i = 0; i < 40; i++) sa.add(createEvent(a, ca, { kind: "ok", household: `hh-a${i}`, source: { type: "sim" } }));
    for (let i = 0; i < 25; i++) sb.add(createEvent(b, cb, { kind: "ok", household: `hh-b${i}`, source: { type: "sim" } }));
    const stats = await syncWith(sa, a.id, memPeer(sb, b.id));
    assert.equal(stats.pulled, 25);
    assert.equal(stats.pushed, 40);
    assert.deepEqual(sa.digest(), sb.digest());
    const again = await syncWith(sa, a.id, memPeer(sb, b.id));
    assert.equal(again.inSync, true);
  });

  it("rejects forged events pushed by a peer", async () => {
    const a = generateIdentity();
    const sa = new EventStore();
    const ev = createEvent(a, new HybridClock(a.id), { kind: "ok", household: "hh-x1", source: { type: "sim" } });
    const res = handlePush(sa, { from: a.id, events: [{ ...ev, household: "hh-evil" }, ev] });
    assert.deepEqual(res, { added: 1, rejected: 1 });
  });

  it("persists to disk and survives a torn final line", () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-"));
    const path = join(dir, "events.jsonl");
    const a = generateIdentity();
    const c = new HybridClock(a.id);
    const s1 = new EventStore(new JsonlFileAdapter(path));
    for (let i = 0; i < 5; i++) s1.add(createEvent(a, c, { kind: "ok", household: `hh-p${i}`, source: { type: "sim" } }));
    writeFileSync(path, readFileSync(path, "utf8") + '{"id":"torn', { flag: "w" });
    const s2 = new EventStore(new JsonlFileAdapter(path));
    assert.equal(s2.size, 5);
    assert.deepEqual(s1.digest(), s2.digest());
  });
});

describe("beacon frames", () => {
  const key = hexToBytes("00112233445566778899aabbccddeeff");
  it("round-trips and authenticates", () => {
    const f = encodeFrame("pl-b01", key, "help", 0xdeadbeef, 7);
    const r = decodeFrame("pl-b01", key, f);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.frame.incident, "pl-b01:deadbeef:7");
  });
  it("a kind 4 fall frame round-trips and authenticates", () => {
    const f = encodeFrame("pl-b01", key, "fall", 0x12340001, 3);
    const r = decodeFrame("pl-b01", key, f);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.frame.kind, "fall");
      assert.equal(r.frame.incident, "pl-b01:12340001:3");
    }
  });
  it("signs-of-life kinds 5 to 8 round-trip and authenticate", () => {
    const kinds = ["moved", "lights_on", "lights_off", "presence"] as const;
    for (let i = 0; i < kinds.length; i += 1) {
      const kind = kinds[i]!;
      const f = encodeFrame("pl-b01", key, kind, 0xabc10000 + i, 10 + i);
      const r = decodeFrame("pl-b01", key, f);
      assert.equal(r.ok, true, kind);
      if (r.ok) {
        assert.equal(r.frame.kind, kind);
        assert.equal(f[1], 5 + i);
      }
    }
  });
  it("rejects a frame with a flipped bit", () => {
    const f = encodeFrame("pl-b01", key, "help", 1, 1);
    f[6] = f[6]! ^ 0x01;
    assert.equal(decodeFrame("pl-b01", key, f).ok, false);
  });
  it("rejects a frame claimed by another beacon id", () => {
    const f = encodeFrame("pl-b01", key, "help", 1, 1);
    assert.equal(decodeFrame("pl-b02", key, f).ok, false);
  });
  it("guards against duplicates, replays and floods", () => {
    let t = 0;
    const g = new BeaconGuard(750, () => t);
    const mk = (counter: number) => ({ beaconId: "pl-b01", kind: "help" as const, session: 9, counter, incident: "" });
    assert.equal(g.check(mk(1)), "accept");
    assert.equal(g.check(mk(1)), "duplicate");
    t += 100;
    assert.equal(g.check(mk(2)), "flood");
    t += 1000;
    assert.equal(g.check(mk(3)), "accept");
    assert.equal(g.check(mk(2)), "replay");
  });
  it("treats an exact double send as duplicate and an older counter as replay", () => {
    let t = 0;
    const g = new BeaconGuard(750, () => t);
    const mk = (counter: number) => ({
      beaconId: "pl-b01",
      kind: "lights_on" as const,
      session: 3,
      counter,
      incident: "",
    });
    assert.equal(g.check(mk(10)), "accept");
    t += 1000;
    assert.equal(g.check(mk(10)), "duplicate");
    assert.equal(g.check(mk(9)), "replay");
    assert.equal(g.check(mk(11)), "accept");
  });
});

describe("projection", () => {
  it("tracks help, corroboration, ack and resolution", () => {
    const n1 = generateIdentity();
    const n2 = generateIdentity();
    let t = 1_700_000_000_000;
    const c1 = new HybridClock(n1.id, () => t);
    const c2 = new HybridClock(n2.id, () => t);
    const h1 = createEvent(n1, c1, { kind: "help", household: "hh-maple-12", incident: "pl-b01:00000001:1", source: { type: "beacon", beacon: "pl-b01", rssi: -70 } });
    t += 5;
    const h2 = createEvent(n2, c2, { kind: "help", household: "hh-maple-12", incident: "pl-b01:00000001:1", source: { type: "beacon", beacon: "pl-b01", rssi: -55 } });
    let p = project([h2, h1]);
    assert.equal(p.incidents.length, 1);
    assert.equal(p.incidents[0]!.witnesses.length, 2);
    assert.equal(p.incidents[0]!.bestRssi, -55);
    assert.equal(p.households[0]!.status, "help");
    t += 5;
    const ack = createEvent(n2, c2, { kind: "ack", household: "hh-maple-12", ref: h1.id, source: { type: "console" } });
    p = project([h1, h2, ack]);
    assert.equal(p.incidents[0]!.status, "acknowledged");
    t += 5;
    const ok = createEvent(n1, c1, { kind: "ok", household: "hh-maple-12", source: { type: "beacon", beacon: "pl-b01" } });
    p = project([ok, ack, h2, h1]);
    assert.equal(p.incidents[0]!.status, "resolved");
    assert.equal(p.households[0]!.status, "ok");
  });

  it("collects neighbour replies on an incident", () => {
    const n1 = generateIdentity();
    const n2 = generateIdentity();
    let t = 1_700_000_000_000;
    const c1 = new HybridClock(n1.id, () => t);
    const c2 = new HybridClock(n2.id, () => t);
    const help = createEvent(n1, c1, {
      kind: "help",
      household: "hh-maple-12",
      incident: "pl-b01:00000002:1",
      source: { type: "beacon", beacon: "pl-b01" },
    });
    t += 5;
    const reply = createEvent(n2, c2, {
      kind: "reply",
      household: "hh-maple-12",
      incident: "pl-b01:00000002:1",
      ref: help.id,
      actor: "hh-oak-19",
      reply: "generator",
      note: "Running now",
      source: { type: "console" },
    });
    const p = project([help, reply]);
    assert.equal(p.incidents[0]!.replies.length, 1);
    assert.equal(p.incidents[0]!.replies[0]!.reply, "generator");
    assert.equal(p.incidents[0]!.replies[0]!.actor, "hh-oak-19");
  });
});

describe("escalationTier", () => {
  it("moves from buddies to street to city, and clears when acknowledged", () => {
    const opened = 1_000_000;
    assert.equal(
      escalationTier({ incidentOpenedAt: opened, acked: false, now: opened + 100_000, buddyWindowSec: 300, streetWindowSec: 300 }),
      "buddies",
    );
    assert.equal(
      escalationTier({ incidentOpenedAt: opened, acked: false, now: opened + 400_000, buddyWindowSec: 300, streetWindowSec: 300 }),
      "street",
    );
    assert.equal(
      escalationTier({ incidentOpenedAt: opened, acked: false, now: opened + 700_000, buddyWindowSec: 300, streetWindowSec: 300 }),
      "city",
    );
    assert.equal(
      escalationTier({ incidentOpenedAt: opened, acked: true, now: opened + 100_000, buddyWindowSec: 300, streetWindowSec: 300 }),
      null,
    );
  });
});

describe("reply events", () => {
  it("rejects over-long reply text", () => {
    const me = generateIdentity();
    const clock = new HybridClock(me.id);
    const help = createEvent(me, clock, {
      kind: "help",
      household: "hh-maple-12",
      incident: "x:1:1",
      source: { type: "console" },
    });
    assert.throws(
      () =>
        createEvent(me, clock, {
          kind: "reply",
          household: "hh-maple-12",
          ref: help.id,
          actor: "hh-oak-19",
          reply: "omw",
          note: "x".repeat(141),
          source: { type: "console" },
        }),
      /at most 140/,
    );
  });
});

describe("notice events", () => {
  it("accepts bilingual notice within limits", () => {
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    const ev = createEvent(city, clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Shelter open on Main.", fr: "Refuge ouvert sur Main.", severity: "info" },
      source: { type: "console" },
    });
    const v = verifyEvent(ev, { cityOrigin: city.id });
    assert.equal(v.ok, true);
  });

  it("rejects English over 280 and French over 320", () => {
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    assert.throws(
      () =>
        createEvent(city, clock, {
          kind: "notice",
          household: "city-hall",
          notice: { en: "e".repeat(281), fr: "ok", severity: "info" },
          source: { type: "console" },
        }),
    );
    assert.throws(
      () =>
        createEvent(city, clock, {
          kind: "notice",
          household: "city-hall",
          notice: { en: "ok", fr: "f".repeat(321), severity: "urgent" },
          source: { type: "console" },
        }),
    );
  });

  it("rejects empty language strings", () => {
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    assert.throws(
      () =>
        createEvent(city, clock, {
          kind: "notice",
          household: "city-hall",
          notice: { en: "", fr: "ok", severity: "info" },
          source: { type: "console" },
        }),
    );
  });

  it("rejects a notice not signed by the pinned city", () => {
    const city = generateIdentity();
    const other = generateIdentity();
    const clock = new HybridClock(other.id);
    const ev = createEvent(other, clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Fake", fr: "Faux", severity: "urgent" },
      source: { type: "console" },
    });
    let logged = 0;
    const v = verifyEvent(ev, { cityOrigin: city.id, onNoticeRejected: () => (logged += 1) });
    assert.equal(v.ok, false);
    if (v.ok === false) assert.match(v.reason, /not signed by the City/);
    assert.equal(logged, 1);
  });

  it("holds a signed notice as pending when the city id is not pinned yet", () => {
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    const ev = createEvent(city, clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Centre open.", fr: "Centre ouvert.", severity: "info" },
      source: { type: "console" },
    });
    const v = verifyEvent(ev, { cityOrigin: null });
    assert.equal(v.ok, "pending_city");
    if (v.ok === "pending_city") assert.equal(v.event.id, ev.id);
    const store = new EventStore(undefined, () => ({ cityOrigin: null }));
    const add = store.add(ev);
    assert.equal(add.added, false);
    assert.equal(add.pending, true);
    assert.equal(store.pendingNoticeCount, 1);
  });
});

describe("alive events", () => {
  it("creates and verifies an alive event with a signal", () => {
    const me = generateIdentity();
    const clock = new HybridClock(me.id);
    const ev = createEvent(me, clock, {
      kind: "alive",
      household: "hh-maple-12",
      signal: "motion",
      source: { type: "beacon", beacon: "pl-b01" },
    });
    assert.equal(ev.kind, "alive");
    assert.equal(ev.signal, "motion");
    assert.equal(verifyEvent(ev).ok, true);
  });

  it("rejects an alive event with no signal", () => {
    const me = generateIdentity();
    const clock = new HybridClock(me.id);
    assert.throws(
      () => createEvent(me, clock, { kind: "alive", household: "hh-maple-12", source: { type: "console" } }),
      /signal/,
    );
  });
});
