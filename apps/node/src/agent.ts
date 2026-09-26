import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FALL_NOTE,
  BeaconGuard,
  EventStore,
  HybridClock,
  JsonlFileAdapter,
  MemoryAdapter,
  REPLY_LABELS,
  bytesToHex,
  createEvent,
  decodeFrame,
  decodeHlc,
  encodeFrame,
  escalationTier,
  hexToBytes,
  project,
  syncWith,
  type NodeIdentity,
  type ReplyCode,
  type SignedEvent,
} from "@porchlight/protocol";
import type { NodeConfig } from "./config";
import { ChaosError, HttpPeer } from "./net";

export type UplinkMode = "disabled" | "online" | "cut" | "unreachable" | "connecting";

export interface PeerState {
  url: string;
  id?: string;
  lastOkAt?: number;
  lastError?: string;
  rttMs?: number;
  syncs: number;
}

export interface BeaconState {
  beaconId: string;
  household?: string;
  lastSeenAt?: number;
  lastRssi?: number;
  lastResult?: string;
}

export interface BeaconReport {
  beaconId: string;
  frame: string;
  rssi?: number;
  via: "ble" | "serial" | "sim";
}

export type BeaconOutcome =
  | { ok: true; eventId: string; kind: "help" | "ok" | "test"; incident: string; household: string; corroborated?: boolean }
  | { ok: false; reason: string; status: number };

/**
 * One Porchlight node: a laptop or Pi in someone's home.
 * Owns the event log, hears beacons, gossips with neighbours, and uplinks to the city when it can.
 */
export class NodeAgent {
  readonly store: EventStore;
  readonly clock: HybridClock;
  readonly guard = new BeaconGuard();
  readonly peers: HttpPeer[];
  readonly peerState = new Map<string, PeerState>();
  readonly beacons = new Map<string, BeaconState>();
  private readonly uplinked = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly beaconAckListeners = new Set<(msg: { beaconId: string; frame: string; incident: string }) => void>();
  /** Incidents that already had a beacon-ack published (or handled by this console's /api/ack). */
  private readonly publishedBeaconAcks = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  private uplinkBackoffMs = 0;
  private uplinkNextAt = 0;
  private uplinkPersistTimer?: NodeJS.Timeout;
  /** Pinned city origin: only this signer may create notice events. */
  private cityOrigin: string | null = null;
  uplinkMode: UplinkMode;
  uplinkLastOkAt?: number;
  uplinkLastError?: string;
  chaosDrop: number;
  startedAt = Date.now();

  constructor(
    readonly config: NodeConfig,
    readonly identity: NodeIdentity,
    opts: { persist?: boolean } = {},
  ) {
    const persist = opts.persist ?? true;
    this.store = new EventStore(
      persist ? new JsonlFileAdapter(join(config.dataDir, "events.jsonl")) : new MemoryAdapter(),
      () => ({
        allowedOrigins: config.roster,
        cityOrigin: this.cityOrigin,
        onNoticeRejected: () => console.warn("[node] rejected a notice not signed by the City"),
      }),
    );
    this.clock = new HybridClock(identity.id);
    this.chaosDrop = config.chaosDrop;
    this.uplinkMode = config.cityUrl ? "connecting" : "disabled";
    this.peers = config.peers.map((url) => new HttpPeer(url, config.networkKey, () => this.chaosDrop));
    for (const p of this.peers) this.peerState.set(p.url, { url: p.url, syncs: 0 });
    for (const [beaconId, b] of Object.entries(config.households.beacons)) {
      this.beacons.set(beaconId, { beaconId, household: b.household });
    }
    this.cityOrigin = config.cityId ?? this.loadPinnedCityId();
    if (persist) this.loadUplinked();
    // Keep the HLC ahead of everything we have seen, and seed the replay guard from history.
    for (const ev of this.store.all()) this.observe(ev);
    this.store.onAdd((ev) => {
      this.observe(ev);
      if (ev.kind === "ack") this.maybePublishBeaconAck(ev);
      this.changed();
    });
  }

  private observe(ev: SignedEvent): void {
    this.clock.observe(decodeHlc(ev.hlc));
    // Learn beacon counters from every node's observations, so an old frame replayed at any node is caught.
    if (ev.source.type === "beacon" && ev.incident) {
      const [beaconId, sessionHex, counter] = ev.incident.split(":");
      if (beaconId && sessionHex && counter) this.guard.seen(beaconId, parseInt(sessionHex, 16), Number(counter));
    }
  }

  /**
   * When an ack arrives from the city or another node for a beacon help event, publish the
   * authenticated ack frame so a connected console can turn the beacon green.
   */
  private maybePublishBeaconAck(ack: SignedEvent): void {
    if (!ack.ref) return;
    const help = this.store.get(ack.ref);
    if (!help || help.kind !== "help" || help.source.type !== "beacon" || !help.source.beacon || !help.incident) return;
    if (this.publishedBeaconAcks.has(help.incident)) return;
    // This console's own "I'm on my way" already returns the frame over HTTP.
    if (ack.origin === this.identity.id) {
      this.publishedBeaconAcks.add(help.incident);
      return;
    }
    const built = this.beaconAckFrame(help.incident);
    if (!built) return;
    this.publishedBeaconAcks.add(help.incident);
    for (const fn of this.beaconAckListeners) fn({ beaconId: built.beaconId, frame: built.frame, incident: help.incident });
  }

  /** Build the authenticated ack frame a beacon expects for one incident key. */
  beaconAckFrame(incidentKey: string): { beaconId: string; frame: string } | undefined {
    const [beaconId, sessionHex, counter] = incidentKey.split(":");
    const key = beaconId ? this.config.beaconKeys.get(beaconId) : undefined;
    if (!key || !beaconId || !sessionHex || !counter) return undefined;
    return {
      beaconId,
      frame: bytesToHex(encodeFrame(beaconId, key, "ack", parseInt(sessionHex, 16), Number(counter))),
    };
  }

  // Lifecycle

  start(): void {
    this.timers.push(setInterval(() => void this.gossipRound(), this.config.gossipIntervalMs));
    if (this.config.cityUrl) this.timers.push(setInterval(() => void this.uplinkRound(), 500));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.uplinkPersistTimer) clearTimeout(this.uplinkPersistTimer);
    this.persistUplinked();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onBeaconAck(fn: (msg: { beaconId: string; frame: string; incident: string }) => void): () => void {
    this.beaconAckListeners.add(fn);
    return () => this.beaconAckListeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  // Local actions

  householdForBeacon(beaconId: string): string | undefined {
    return this.config.households.beacons[beaconId]?.household;
  }

  langFor(household: string): "en" | "fr" {
    return this.config.households.households[household]?.lang ?? this.config.defaultLang;
  }

  /** A beacon frame relayed by the browser (Web Bluetooth / Web Serial). Authenticated here, never in the browser. */
  handleBeacon(report: BeaconReport): BeaconOutcome {
    const state = this.beacons.get(report.beaconId) ?? { beaconId: report.beaconId };
    this.beacons.set(report.beaconId, state);
    state.lastSeenAt = Date.now();
    if (report.rssi !== undefined) state.lastRssi = report.rssi;
    const fail = (reason: string, status: number): BeaconOutcome => {
      state.lastResult = reason;
      this.changed();
      return { ok: false, reason, status };
    };
    const key = this.config.beaconKeys.get(report.beaconId);
    if (!key) return fail("unknown beacon (no key configured)", 403);
    const household = this.householdForBeacon(report.beaconId);
    if (!household) return fail("beacon is not assigned to a household", 409);
    let bytes: Uint8Array;
    try {
      bytes = hexToBytes(report.frame);
    } catch {
      return fail("frame is not hex", 400);
    }
    const decoded = decodeFrame(report.beaconId, key, bytes);
    if (!decoded.ok) return fail(decoded.reason, 401);
    const f = decoded.frame;
    if (f.kind === "ack") return fail("beacons cannot send acks", 400);
    const helpLike = f.kind === "help" || f.kind === "fall";
    const verdict = this.guard.check(f);
    if (verdict === "duplicate" && helpLike) {
      // Another node already reported this press. If we heard it directly too, add our signed
      // observation: two independent witnesses make a false alarm much less likely.
      const inc = project(this.store.all()).incidents.find((i) => i.key === f.incident);
      if (inc && !inc.witnesses.includes(this.identity.id)) {
        const ev = createEvent(this.identity, this.clock, {
          kind: "help",
          household,
          incident: f.incident,
          source: { type: "beacon", beacon: report.beaconId, rssi: report.rssi },
          lang: this.langFor(household),
          note: f.kind === "fall" ? FALL_NOTE : undefined,
        });
        this.store.add(ev);
        state.lastResult = "corroborated";
        return { ok: true, eventId: ev.id, kind: "help", incident: f.incident, household, corroborated: true };
      }
    }
    if (verdict !== "accept") return fail(verdict, verdict === "duplicate" ? 200 : 429);
    state.lastResult = `accepted ${f.kind}`;
    if (f.kind === "test") {
      this.changed();
      return { ok: true, eventId: "", kind: "test", incident: f.incident, household };
    }
    const eventKind = f.kind === "fall" ? "help" : f.kind;
    const ev = createEvent(this.identity, this.clock, {
      kind: eventKind,
      household,
      incident: helpLike ? f.incident : undefined,
      source: { type: "beacon", beacon: report.beaconId, rssi: report.rssi },
      lang: this.langFor(household),
      note: f.kind === "fall" ? FALL_NOTE : undefined,
    });
    this.store.add(ev);
    return { ok: true, eventId: ev.id, kind: eventKind, incident: f.incident, household };
  }

  private simSessions = new Map<string, { session: number; counter: number }>();

  /** Development helper: builds a genuine authenticated frame as if the Arduino sent it. */
  simulateBeaconPress(beaconId: string, kind: "help" | "ok" | "test" | "fall"): BeaconOutcome {
    const key = this.config.beaconKeys.get(beaconId);
    if (!key) return { ok: false, reason: "unknown beacon (no key configured)", status: 403 };
    const s = this.simSessions.get(beaconId) ?? { session: (Math.random() * 0xffffffff) >>> 0, counter: 0 };
    s.counter++;
    this.simSessions.set(beaconId, s);
    const frame = bytesToHex(encodeFrame(beaconId, key, kind, s.session, s.counter));
    return this.handleBeacon({ beaconId, frame, rssi: -60 - Math.round(Math.random() * 20), via: "sim" });
  }

  /** Check-in from the node console, for households without a beacon. */
  consoleCheckin(household: string, kind: "help" | "ok", note?: string): SignedEvent {
    if (!this.config.households.households[household]) throw new Error("unknown household");
    const ev = createEvent(this.identity, this.clock, {
      kind,
      household,
      incident: kind === "help" ? `ui-${this.identity.id}-${Date.now().toString(36)}` : undefined,
      source: { type: "console" },
      lang: this.langFor(household),
      note: note?.trim() || undefined,
    });
    this.store.add(ev);
    return ev;
  }

  /**
   * A neighbour acknowledges an alert. Returns an authenticated ack frame the browser can
   * write back to the beacon so its light turns green. The beacon verifies the MAC.
   */
  acknowledge(incidentKey: string): { event: SignedEvent; ackFrame?: string } {
    const inc = project(this.store.all()).incidents.find((i) => i.key === incidentKey);
    if (!inc) throw new Error("unknown incident");
    const ev = createEvent(this.identity, this.clock, {
      kind: "ack",
      household: inc.household,
      ref: inc.eventId,
      source: { type: "console" },
    });
    this.store.add(ev);
    const built = this.beaconAckFrame(inc.key);
    if (built) this.publishedBeaconAcks.add(inc.key);
    return { event: ev, ackFrame: built?.frame };
  }

  /**
   * A neighbour's quick reply on the mesh (Porch Circles). "On my way" also writes the normal ack
   * so the beacon turns green.
   */
  reply(
    incidentKey: string,
    code: ReplyCode,
    text?: string,
  ): { reply: SignedEvent; ack?: SignedEvent; ackFrame?: string } {
    const actor = this.config.household;
    if (!actor) throw new Error("NODE_HOUSEHOLD is not set on this node");
    const inc = project(this.store.all()).incidents.find((i) => i.key === incidentKey);
    if (!inc) throw new Error("unknown incident");
    if (inc.status === "resolved") throw new Error("incident already resolved");
    const note = text?.trim() || undefined;
    const replyEv = createEvent(this.identity, this.clock, {
      kind: "reply",
      household: inc.household,
      incident: inc.key,
      ref: inc.eventId,
      actor,
      reply: code,
      note,
      source: { type: "console" },
    });
    this.store.add(replyEv);
    if (code === "omw" && inc.status === "open") {
      const ack = this.acknowledge(incidentKey);
      return { reply: replyEv, ack: ack.event, ackFrame: ack.ackFrame };
    }
    return { reply: replyEv };
  }

  setUplinkCut(cut: boolean): void {
    if (!this.config.cityUrl) return;
    this.uplinkMode = cut ? "cut" : "connecting";
    this.uplinkBackoffMs = 0;
    this.uplinkNextAt = 0;
    this.changed();
  }

  setChaos(drop: number): void {
    this.chaosDrop = Math.min(0.95, Math.max(0, drop));
    this.changed();
  }

  // Gossip

  async gossipRound(): Promise<void> {
    if (!this.peers.length) return;
    const shuffled = [...this.peers].sort(() => Math.random() - 0.5).slice(0, this.config.gossipFanout);
    await Promise.all(
      shuffled.map(async (peer) => {
        const st = this.peerState.get(peer.url)!;
        const t0 = performance.now();
        try {
          const stats = await syncWith(this.store, this.identity.id, peer);
          st.lastOkAt = Date.now();
          st.rttMs = Math.round(performance.now() - t0);
          st.lastError = undefined;
          st.syncs++;
          if (!stats.inSync) this.changed();
        } catch (err) {
          st.lastError = err instanceof ChaosError ? "packet dropped (chaos)" : (err as Error).message;
        }
      }),
    );
  }

  // Uplink

  pendingUplink(): SignedEvent[] {
    return this.store.all().filter((e) => !this.uplinked.has(e.id));
  }

  async uplinkRound(): Promise<void> {
    const cityUrl = this.config.cityUrl;
    if (!cityUrl || this.uplinkMode === "cut") return;
    if (Date.now() < this.uplinkNextAt) return;
    const pending = this.pendingUplink().slice(0, 250);
    const heldNotices = this.store
      .all()
      .filter((e) => e.kind === "notice" && this.cityOrigin && e.origin === this.cityOrigin)
      .map((e) => e.id)
      .slice(0, 200);
    this.uplinkNextAt = Date.now() + this.config.uplinkIntervalMs;
    try {
      const res = await fetch(`${cityUrl}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.cityToken}` },
        body: JSON.stringify({
          node: { id: this.identity.id, name: this.config.name },
          events: pending,
          heldNotices,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`city ingest → HTTP ${res.status}`);
      const body = (await res.json()) as {
        accepted?: string[];
        duplicates?: string[];
        cityEvents?: unknown;
        cityId?: unknown;
      };
      if (typeof body.cityId === "string" && /^[0-9a-f]{16}$/.test(body.cityId)) {
        this.pinCityId(body.cityId);
      }
      for (const id of [...(body.accepted ?? []), ...(body.duplicates ?? [])]) this.uplinked.add(id);
      // Downlink must never fail the delivery: missing or malformed cityEvents are an empty list,
      // and each bad event is skipped so accepted uploads still count as delivered.
      let gotCity = false;
      try {
        let skipped = 0;
        const cityEvents = Array.isArray(body.cityEvents) ? body.cityEvents : [];
        for (const raw of cityEvents) {
          try {
            const r = this.store.add(raw);
            if (r.added || r.reason === "duplicate") {
              const id = String((raw as { id?: unknown })?.id ?? "");
              if (id) this.uplinked.add(id);
              if (r.added) gotCity = true;
            } else {
              skipped += 1;
            }
          } catch {
            skipped += 1;
          }
        }
        if (skipped) console.warn(`[node] skipped ${skipped} city event(s) from downlink`);
      } catch (err) {
        console.warn("[node] cityEvents downlink failed:", (err as Error).message);
      }
      const was = this.uplinkMode;
      if ((this.uplinkMode as UplinkMode) !== "cut") this.uplinkMode = "online";
      this.uplinkLastOkAt = Date.now();
      this.uplinkLastError = undefined;
      this.uplinkBackoffMs = 0;
      if (pending.length || gotCity) this.schedulePersistUplinked();
      if (was !== this.uplinkMode || pending.length || gotCity) this.changed();
      // Drain a backlog quickly after an outage.
      if (pending.length === 250) this.uplinkNextAt = 0;
    } catch (err) {
      if ((this.uplinkMode as UplinkMode) === "cut") return;
      this.uplinkMode = "unreachable";
      this.uplinkLastError = (err as Error).message;
      this.uplinkBackoffMs = Math.min(30_000, Math.max(1000, this.uplinkBackoffMs * 2));
      this.uplinkNextAt = Date.now() + this.uplinkBackoffMs * (0.75 + Math.random() * 0.5);
      this.changed();
    }
  }

  private loadPinnedCityId(): string | null {
    const path = join(this.config.dataDir, "city-id.json");
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { cityId?: unknown };
      if (typeof raw.cityId === "string" && /^[0-9a-f]{16}$/.test(raw.cityId)) return raw.cityId;
    } catch {
      /* ignore */
    }
    return null;
  }

  private pinCityId(cityId: string): void {
    if (this.cityOrigin === cityId) return;
    this.cityOrigin = cityId;
    try {
      writeFileSync(join(this.config.dataDir, "city-id.json"), JSON.stringify({ cityId }), { mode: 0o600 });
    } catch {
      /* non-fatal: in-memory pin still works until restart */
    }
  }

  private loadUplinked(): void {
    const path = join(this.config.dataDir, "uplinked.json");
    if (!existsSync(path)) return;
    try {
      for (const id of JSON.parse(readFileSync(path, "utf8")) as string[]) this.uplinked.add(id);
    } catch {
      // Losing this file only means re-sending events; the city dedupes by id.
    }
  }

  private schedulePersistUplinked(): void {
    if (this.uplinkPersistTimer) return;
    this.uplinkPersistTimer = setTimeout(() => {
      this.uplinkPersistTimer = undefined;
      this.persistUplinked();
    }, 1000);
  }

  private persistUplinked(): void {
    try {
      writeFileSync(join(this.config.dataDir, "uplinked.json"), JSON.stringify([...this.uplinked]), { mode: 0o600 });
    } catch {
      // non-fatal
    }
  }

  // View

  state() {
    const events = this.store.all();
    const p = project(events);
    const label = (h: string) => this.config.households.households[h]?.label ?? h;
    const now = Date.now();
    const myHome = this.config.household;
    const known = new Set(p.households.map((h) => h.household));
    const households = [
      ...p.households,
      ...Object.keys(this.config.households.households)
        .filter((h) => !known.has(h))
        .map((h) => ({ household: h, status: "unknown" as const, lastEventAt: "" })),
    ].map((h) => {
      const info = this.config.households.households[h.household];
      return {
        ...h,
        label: label(h.household),
        lang: this.langFor(h.household),
        buddies: info?.buddies ?? [],
      };
    });
    return {
      node: {
        id: this.identity.id,
        name: this.config.name,
        pub: this.identity.pub,
        startedAt: this.startedAt,
        household: myHome ?? null,
        householdLabel: myHome ? label(myHome) : null,
      },
      circles: {
        buddyWindowSec: this.config.buddyWindowSec,
        streetWindowSec: this.config.streetWindowSec,
      },
      uplink: {
        mode: this.uplinkMode,
        cityUrl: this.config.cityUrl ?? null,
        lastOkAt: this.uplinkLastOkAt ?? null,
        lastError: this.uplinkLastError ?? null,
        pending: events.length - [...this.uplinked].filter((id) => this.store.has(id)).length,
      },
      peers: [...this.peerState.values()],
      chaos: { drop: this.chaosDrop },
      dev: { simulateBeacon: this.config.devSimulateBeacon, beaconIds: [...this.config.beaconKeys.keys()] },
      counts: { events: events.length, rejected: this.store.rejected },
      beacons: [...this.beacons.values()].map((b) => ({ ...b, label: b.household ? label(b.household) : undefined })),
      households,
      incidents: p.incidents.map((i) => {
        const openedAtMs = decodeHlc(i.openedAt).wall;
        const tier = escalationTier({
          incidentOpenedAt: openedAtMs,
          acked: i.status !== "open",
          now,
          buddyWindowSec: this.config.buddyWindowSec,
          streetWindowSec: this.config.streetWindowSec,
        });
        const buddies = this.config.households.households[i.household]?.buddies ?? [];
        const isBuddy = Boolean(myHome && buddies.includes(myHome));
        return {
          ...i,
          label: label(i.household),
          openedAtMs,
          tier,
          isBuddy,
          replies: i.replies.map((r) => ({
            ...r,
            atMs: decodeHlc(r.at).wall,
            actorLabel: label(r.actor),
            replyLabel: REPLY_LABELS[r.reply],
          })),
        };
      }),
      recent: events.slice(-40).reverse().map((e) => ({
        id: e.id,
        kind: e.kind,
        household: e.household,
        label: label(e.household),
        origin: e.origin,
        mine: e.origin === this.identity.id,
        at: decodeHlc(e.hlc).wall,
        source: e.source.type,
        uplinked: this.uplinked.has(e.id),
      })),
    };
  }
}
