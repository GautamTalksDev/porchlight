import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import {
  HybridClock,
  JsonlFileAdapter,
  createEvent,
  generateIdentity,
} from "@porchlight/protocol";
import { NodeAgent } from "../src/agent";
import { loadConfig } from "../src/config";

const householdsFile = new URL("../../../config/households.json", import.meta.url).pathname;

function baseEnv(dataDir: string): NodeJS.ProcessEnv {
  return {
    NODE_NAME: "node-notice-pin",
    PORT: "7401",
    DATA_DIR: dataDir,
    PEERS: "",
    BEACON_KEYS: "",
    HOUSEHOLDS_FILE: householdsFile,
  };
}

describe("node city notice pin and restart", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("keeps a City notice across restart when city-id is loaded before the log", () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-notice-restart-"));
    dirs.push(dir);
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    const notice = createEvent(city, clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Warming centre open.", fr: "Centre de réchauffement ouvert.", severity: "info" },
      source: { type: "console" },
    });
    writeFileSync(join(dir, "city-id.json"), JSON.stringify({ cityId: city.id }), { mode: 0o600 });
    const adapter = new JsonlFileAdapter(join(dir, "events.jsonl"));
    adapter.append(notice);

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      const agent = new NodeAgent(loadConfig(baseEnv(dir)), generateIdentity(), { persist: true });
      assert.equal(agent.pinnedCityId(), city.id);
      assert.equal(agent.store.has(notice.id), true);
      assert.equal(
        warns.some((w) => /rejected a notice not signed by the City/.test(w)),
        false,
      );
      agent.stop();
    } finally {
      console.warn = origWarn;
    }
  });

  it("holds a notice received before pinning and accepts it after the City id arrives", () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-notice-pending-"));
    dirs.push(dir);
    const city = generateIdentity();
    const clock = new HybridClock(city.id);
    const notice = createEvent(city, clock, {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Boil water advisory.", fr: "Avis d'ébullition.", severity: "urgent" },
      source: { type: "console" },
    });
    const agent = new NodeAgent(loadConfig(baseEnv(dir)), generateIdentity(), { persist: false });
    assert.equal(agent.pinnedCityId(), null);
    const held = agent.store.add(notice);
    assert.equal(held.added, false);
    assert.equal(held.pending, true);
    assert.equal(agent.store.has(notice.id), false);
    assert.equal(agent.store.pendingNoticeCount, 1);

    agent.acceptCityId(city.id);
    assert.equal(agent.pinnedCityId(), city.id);
    assert.equal(agent.store.has(notice.id), true);
    assert.equal(agent.store.pendingNoticeCount, 0);
    agent.stop();
  });

  it("still rejects a notice signed by another node after the City is pinned", () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-notice-fake-"));
    dirs.push(dir);
    const city = generateIdentity();
    const faker = generateIdentity();
    const fake = createEvent(faker, new HybridClock(faker.id), {
      kind: "notice",
      household: "city-hall",
      notice: { en: "Fake notice", fr: "Fausse alerte", severity: "urgent" },
      source: { type: "console" },
    });
    const agent = new NodeAgent(loadConfig(baseEnv(dir)), generateIdentity(), { persist: false });
    agent.acceptCityId(city.id);
    const r = agent.store.add(fake);
    assert.equal(r.added, false);
    assert.match(r.reason, /not signed by the City/);
    assert.equal(agent.store.has(fake.id), false);
    agent.stop();
  });
});
