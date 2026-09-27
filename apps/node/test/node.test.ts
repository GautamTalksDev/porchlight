import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { FALL_NOTE, HybridClock, bytesToHex, createEvent, encodeFrame, generateIdentity, hexToBytes } from "@porchlight/protocol";
import { NodeAgent } from "../src/agent";
import { createCityStub } from "../src/city-stub";
import { loadConfig } from "../src/config";
import { createNodeServer } from "../src/server";

const KEY_HEX = "00112233445566778899aabbccddeeff";
const TOKEN = "test-token";

async function listen(server: import("node:http").Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function until(fn: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("three nodes and a city", () => {
  const city = createCityStub(TOKEN);
  let cityPort = 0;
  const nodes: { agent: NodeAgent; server: import("node:http").Server; port: number; token: string }[] = [];

  before(async () => {
    cityPort = await listen(city.server);
    const servers = [0, 1, 2].map(() => ({ port: 0 }));
    // Reserve ports first so peers can reference each other.
    const tmp = await Promise.all(
      servers.map(async () => {
        const s = (await import("node:http")).createServer();
        const p = await listen(s);
        await new Promise((r) => s.close(r));
        return p;
      }),
    );
    for (let i = 0; i < 3; i++) {
      const config = loadConfig(
        {
          NODE_NAME: `node-${i}`,
          NODE_HOUSEHOLD: ["hh-oak-19", "hh-birch-4", "hh-cedar-31"][i],
          PORT: String(tmp[i]),
          DATA_DIR: "/tmp/unused",
          PEERS: tmp.filter((_, j) => j !== i).map((p) => `http://127.0.0.1:${p}`).join(","),
          CITY_URL: `http://127.0.0.1:${cityPort}`,
          CITY_INGEST_TOKEN: TOKEN,
          BEACON_KEYS: `pl-b01:${KEY_HEX}`,
          GOSSIP_INTERVAL_MS: "200",
          UPLINK_INTERVAL_MS: "500",
          HOUSEHOLDS_FILE: new URL("../../../config/households.json", import.meta.url).pathname,
          BUDDY_WINDOW_SEC: "30",
          STREET_WINDOW_SEC: "30",
        },
      );
      const agent = new NodeAgent(config, generateIdentity(), { persist: false });
      const { server, sessionToken } = createNodeServer(agent);
      await new Promise<void>((r) => server.listen(tmp[i], "127.0.0.1", r));
      agent.start();
      nodes.push({ agent, server, port: tmp[i]!, token: sessionToken });
    }
  });

  after(async () => {
    for (const n of nodes) {
      n.agent.stop();
      await new Promise((r) => n.server.close(r));
    }
    await new Promise((r) => city.server.close(r));
  });

  const post = (n: (typeof nodes)[number], path: string, body: unknown, token = n.token) =>
    fetch(`http://127.0.0.1:${n.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-porchlight-token": token },
      body: JSON.stringify(body),
    });

  it("a beacon press reaches every neighbour and the city", async () => {
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 1));
    const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -61 });
    assert.equal(res.status, 200);
    await until(() => nodes.every((n) => n.agent.state().incidents.length === 1));
    await until(() => city.store.size === 1);
    assert.equal(nodes[2]!.agent.state().households.find((h) => h.household === "hh-maple-12")?.status, "help");
  });

  it("rejects a forged frame and a missing session token", async () => {
    const bad = bytesToHex(encodeFrame("pl-b01", new Uint8Array(16), "help", 1, 1));
    const r1 = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame: bad, via: "ble" });
    assert.equal(r1.status, 401);
    const r2 = await post(nodes[0]!, "/api/uplink", { cut: true }, "wrong");
    assert.equal(r2.status, 401);
  });

  it("holds events while the city link is cut and flushes on restore", async () => {
    for (const n of nodes) n.agent.setUplinkCut(true);
    const before = city.store.size;
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 2));
    await new Promise((r) => setTimeout(r, 900)); // clear the flood window
    const res = await post(nodes[1]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble" });
    assert.equal(res.status, 200);
    await until(() => nodes.every((n) => n.agent.state().counts.events === before + 1));
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(city.store.size, before, "city must not receive anything while cut");
    assert.ok(nodes.every((n) => n.agent.state().uplink.pending >= 1));
    for (const n of nodes) n.agent.setUplinkCut(false);
    await until(() => city.store.size === before + 1);
  });

  it("acknowledging returns an authenticated ack frame for the beacon", async () => {
    const inc = nodes[2]!.agent.state().incidents.find((i) => i.status === "open")!;
    const res = await post(nodes[2]!, "/api/ack", { incident: inc.key });
    const body = (await res.json()) as { ackFrame: string };
    assert.match(body.ackFrame, /^[0-9a-f]{36}$/);
    await until(() => nodes[0]!.agent.state().incidents.some((i) => i.key === inc.key && i.status === "acknowledged"));
  });

  it("a press heard by two nodes is corroborated, not duplicated", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 3));
    const r0 = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble" });
    assert.equal(r0.status, 200);
    await until(() => nodes[2]!.agent.state().incidents.some((i) => i.key === "pl-b01:00001234:3"));
    const r2 = await post(nodes[2]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble" });
    assert.equal(r2.status, 200);
    await until(() => nodes[1]!.agent.state().incidents.find((i) => i.key === "pl-b01:00001234:3")?.witnesses.length === 2);
    assert.equal(nodes[1]!.agent.state().incidents.filter((i) => i.key === "pl-b01:00001234:3").length, 1);
  });

  it("replays of an old frame are rejected at any node", async () => {
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 1));
    const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble" });
    assert.equal(res.status, 429);
  });

  it("a fall frame creates a help event whose note is FALL_NOTE", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "fall", 0x1234, 5));
    const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -58 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { kind: string };
    assert.equal(body.kind, "help");
    await until(() => nodes[0]!.agent.state().incidents.some((i) => i.key === "pl-b01:00001234:5" && i.note === FALL_NOTE));
    const inc = nodes[0]!.agent.state().incidents.find((i) => i.key === "pl-b01:00001234:5")!;
    assert.equal(inc.status, "open");
  });

  it("a neighbour reply reaches another node by gossip", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 8));
    const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -50 });
    assert.equal(res.status, 200);
    const key = "pl-b01:00001234:8";
    await until(() => nodes.every((n) => n.agent.state().incidents.some((i) => i.key === key)));
    const replyRes = await post(nodes[1]!, "/api/reply", { incident: key, reply: "generator", note: "Ready" });
    assert.equal(replyRes.status, 200);
    await until(() =>
      nodes[2]!.agent.state().incidents.some((i) => i.key === key && i.replies.some((r) => r.reply === "generator" && r.actor === "hh-birch-4")),
    );
  });

  it("a city-signed ack on uplink reaches the node and then neighbours by gossip", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 9));
    const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -55 });
    assert.equal(res.status, 200);
    const incidentKey = "pl-b01:00001234:9";
    await until(() => city.store.all().some((e) => e.kind === "help" && e.incident === incidentKey));
    const help = city.store.all().find((e) => e.kind === "help" && e.incident === incidentKey)!;
    const ack = createEvent(city.identity, city.clock, {
      kind: "ack",
      household: "hh-maple-12",
      ref: help.id,
      source: { type: "console" },
      lang: "en",
    });
    assert.equal(city.store.add(ack).added, true);
    await until(() => nodes[0]!.agent.state().incidents.some((i) => i.key === incidentKey && i.status === "acknowledged"));
    await until(() => nodes[1]!.agent.state().incidents.some((i) => i.key === incidentKey && i.status === "acknowledged"));
  });

  it("an ack for a beacon incident that arrives by gossip publishes beacon-ack once", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x1234, 10));
    const res = await post(nodes[1]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -52 });
    assert.equal(res.status, 200);
    const incidentKey = "pl-b01:00001234:10";
    await until(() => nodes[0]!.agent.state().incidents.some((i) => i.key === incidentKey));
    const help = nodes[0]!.agent.store.all().find((e) => e.kind === "help" && e.incident === incidentKey)!;
    const pubs: { beaconId: string; frame: string; incident: string }[] = [];
    const off = nodes[0]!.agent.onBeaconAck((m) => pubs.push(m));
    const stranger = generateIdentity();
    const ack = createEvent(stranger, new HybridClock(stranger.id), {
      kind: "ack",
      household: "hh-maple-12",
      ref: help.id,
      source: { type: "console" },
    });
    assert.equal(nodes[2]!.agent.store.add(ack).added, true);
    await until(() => pubs.length >= 1);
    assert.equal(pubs.length, 1);
    assert.equal(pubs[0]!.beaconId, "pl-b01");
    assert.equal(pubs[0]!.incident, incidentKey);
    assert.equal(nodes[0]!.agent.store.add(ack).added, false);
    assert.equal(pubs.length, 1);
    off();
  });

  it("a city notice reaches a second node by gossip", async () => {
    await until(() => nodes.every((n) => n.agent.state().uplink.mode === "online"));
    const notice = createEvent(city.identity, city.clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Shelter open on Main Street.", fr: "Refuge ouvert sur la rue Main.", severity: "info" },
      source: { type: "console" },
    });
    assert.equal(city.store.add(notice).added, true);
    await until(() => nodes[0]!.agent.store.has(notice.id));
    await until(() => nodes[1]!.agent.store.has(notice.id));
    await until(() => nodes[2]!.agent.store.has(notice.id));
  });

  it("rejects a notice signed by another node", async () => {
    await until(() => nodes.every((n) => n.agent.state().uplink.mode === "online"));
    const faker = nodes[0]!.agent.identity;
    const fake = createEvent(faker, new HybridClock(faker.id), {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Fake notice", fr: "Fausse alerte", severity: "urgent" },
      source: { type: "console" },
    });
    for (const n of nodes) {
      const r = n.agent.store.add(fake);
      assert.equal(r.added, false);
      assert.match(r.reason, /not signed by the City/);
    }
  });

  it("beacon signs of life become one alive event each with the right signal", async () => {
    await new Promise((r) => setTimeout(r, 900));
    const kinds = [
      { kind: "moved" as const, signal: "motion", counter: 40 },
      { kind: "presence" as const, signal: "presence", counter: 41 },
      { kind: "lights_on" as const, signal: "lights_on", counter: 42 },
      { kind: "lights_off" as const, signal: "lights_off", counter: 43 },
    ];
    for (const k of kinds) {
      await new Promise((r) => setTimeout(r, 900));
      const before = nodes[0]!.agent.store.all().filter((e) => e.kind === "alive" && e.signal === k.signal).length;
      const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), k.kind, 0xabcd, k.counter));
      const res = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -55 });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { kind: string; eventId: string };
      assert.equal(body.kind, "alive");
      assert.ok(body.eventId);
      const again = await post(nodes[0]!, "/api/beacon", { beaconId: "pl-b01", frame, via: "ble", rssi: -55 });
      assert.equal(again.status, 200);
      const alive = nodes[0]!.agent.store.all().filter((e) => e.kind === "alive" && e.signal === k.signal);
      assert.equal(alive.length, before + 1, `${k.kind} must produce exactly one alive event`);
      assert.equal(alive[alive.length - 1]!.household, "hh-maple-12");
      assert.equal(alive[alive.length - 1]!.signal, k.signal);
    }
    assert.equal(
      nodes[0]!.agent.store.all().filter((e) => e.kind === "help" && (e.incident ?? "").startsWith("pl-b01:0000abcd:4")).length,
      0,
    );
  });
});

describe("uplink with a city that omits cityEvents", () => {
  const legacy = createCityStub(`${TOKEN}-legacy`, { omitCityEvents: true });
  let node: { agent: NodeAgent; server: import("node:http").Server; token: string } | undefined;

  before(async () => {
    await new Promise<void>((r) => legacy.server.listen(0, "127.0.0.1", r));
    const cityPort = (legacy.server.address() as AddressInfo).port;
    const reserved = (await import("node:http")).createServer();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const nodePort = (reserved.address() as AddressInfo).port;
    await new Promise((r) => reserved.close(r));
    const config = loadConfig({
      NODE_NAME: "node-legacy-city",
      PORT: String(nodePort),
      DATA_DIR: "/tmp/unused",
      PEERS: "",
      CITY_URL: `http://127.0.0.1:${cityPort}`,
      CITY_INGEST_TOKEN: `${TOKEN}-legacy`,
      BEACON_KEYS: `pl-b01:${KEY_HEX}`,
      GOSSIP_INTERVAL_MS: "500",
      UPLINK_INTERVAL_MS: "500",
      HOUSEHOLDS_FILE: new URL("../../../config/households.json", import.meta.url).pathname,
    });
    const agent = new NodeAgent(config, generateIdentity(), { persist: false });
    const { server, sessionToken } = createNodeServer(agent);
    await new Promise<void>((r) => server.listen(nodePort, "127.0.0.1", r));
    agent.start();
    node = { agent, server, token: sessionToken };
  });

  after(async () => {
    if (!node) {
      await new Promise((r) => legacy.server.close(r));
      return;
    }
    node.agent.stop();
    await new Promise((r) => node!.server.close(r));
    await new Promise((r) => legacy.server.close(r));
  });

  it("stays connected and marks events delivered when the city omits cityEvents", async () => {
    const n = node!;
    const listenPort = (n.server.address() as AddressInfo).port;
    const frame = bytesToHex(encodeFrame("pl-b01", hexToBytes(KEY_HEX), "help", 0x99, 1));
    const res = await fetch(`http://127.0.0.1:${listenPort}/api/beacon`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-porchlight-token": n.token },
      body: JSON.stringify({ beaconId: "pl-b01", frame, via: "ble", rssi: -60 }),
    });
    assert.equal(res.status, 200);
    await until(() => legacy.store.size >= 1);
    await until(() => n.agent.state().uplink.mode === "online" && n.agent.state().uplink.pending === 0);
    assert.equal(n.agent.state().uplink.mode, "online");
    assert.equal(n.agent.state().uplink.pending, 0);
  });
});
