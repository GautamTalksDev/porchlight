import "server-only";
import {
  EventStore,
  createEvent,
  decodeHlc,
  project,
  verifyEvent,
  type SignedEvent,
} from "@porchlight/protocol";
import { dbEnabled, foldTimeline, getSetting, holdStats, insertEvents, loadAllEvents, recordDelivery, setSetting, timeline, type TimelineBucket } from "./db";
import { cityIdentity } from "./identity";
import { NEED_LABELS, registry } from "./registry";

export interface NodeSeen {
  id: string;
  name: string;
  lastSeenAt: number;
  delivered: number;
}

export type CityMessage =
  | { type: "delivery"; node: { id: string; name: string }; events: Pick<SignedEvent, "id" | "kind" | "household" | "origin" | "incident">[] }
  | { type: "outage"; down: boolean }
  | { type: "action"; kind: string; household: string };

interface CityState {
  ready: Promise<void>;
  store: EventStore;
  nodes: Map<string, NodeSeen>;
  receivedAt: Map<string, number>;
  deliveredBy: Map<string, string>;
  outage: boolean;
  listeners: Set<(m: CityMessage) => void>;
}

const g = globalThis as unknown as { __plCity?: CityState };

/** The city's in-memory view, backed by Tiger Data when DATABASE_URL is set. One per server process. */
export function city(): CityState {
  if (g.__plCity) return g.__plCity;
  const state: CityState = {
    ready: Promise.resolve(),
    store: new EventStore(),
    nodes: new Map(),
    receivedAt: new Map(),
    deliveredBy: new Map(),
    outage: false,
    listeners: new Set(),
  };
  state.ready = (async () => {
    if (!dbEnabled()) return;
    try {
      for (const raw of await loadAllEvents()) state.store.add(raw);
      state.outage = (await getSetting<boolean>("outage")) ?? false;
      console.log(`[city] loaded ${state.store.size} events from Tiger Data`);
    } catch (err) {
      console.error("[city] could not load from the database, starting empty:", (err as Error).message);
    }
  })();
  g.__plCity = state;
  return state;
}

function emit(m: CityMessage): void {
  for (const fn of city().listeners) {
    try {
      fn(m);
    } catch {
      /* a broken listener must never break ingest */
    }
  }
}

export function subscribe(fn: (m: CityMessage) => void): () => void {
  city().listeners.add(fn);
  return () => city().listeners.delete(fn);
}

export interface IngestResult {
  accepted: string[];
  duplicates: string[];
  rejected: { id: string; reason: string }[];
}

/**
 * Accept a batch from a node. Every event is verified before it is stored, and it is written to
 * Tiger Data before it is acknowledged, so a node only forgets an event once it is durable here.
 */
export async function ingest(node: { id: string; name: string }, raw: unknown[]): Promise<IngestResult> {
  const c = city();
  await c.ready;
  const result: IngestResult = { accepted: [], duplicates: [], rejected: [] };
  const fresh: SignedEvent[] = [];
  for (const item of raw) {
    const id = String((item as { id?: unknown })?.id ?? "").slice(0, 64);
    if (c.store.has(id)) {
      result.duplicates.push(id);
      continue;
    }
    const v = verifyEvent(item);
    if (!v.ok) {
      result.rejected.push({ id, reason: v.reason });
      continue;
    }
    fresh.push(v.event);
  }
  if (dbEnabled() && fresh.length) await insertEvents(fresh, node.id); // throws: node keeps its events and retries
  for (const ev of fresh) {
    c.store.add(ev);
    c.receivedAt.set(ev.id, Date.now());
    c.deliveredBy.set(ev.id, node.name);
    result.accepted.push(ev.id);
  }
  const seen = c.nodes.get(node.id) ?? { id: node.id, name: node.name, lastSeenAt: 0, delivered: 0 };
  seen.lastSeenAt = Date.now();
  seen.delivered += result.accepted.length;
  seen.name = node.name;
  c.nodes.set(node.id, seen);
  if (dbEnabled() && (raw.length || result.rejected.length)) {
    recordDelivery(node.id, node.name, result.accepted.length, result.duplicates.length, result.rejected.length).catch(() => {});
  }
  if (fresh.length) {
    emit({ type: "delivery", node, events: fresh.map((e) => ({ id: e.id, kind: e.kind, household: e.household, origin: e.origin, incident: e.incident })) });
  }
  return result;
}

export async function setOutage(down: boolean): Promise<void> {
  const c = city();
  c.outage = down;
  if (dbEnabled()) await setSetting("outage", down).catch((e) => console.error("[city] outage setting not saved", e.message));
  emit({ type: "outage", down });
}

/** A coordinator or the voice agent acts on a household. Signed with the city's own key. */
export async function cityAction(kind: "ok" | "ack", household: string, opts: { incident?: string; note?: string } = {}): Promise<SignedEvent> {
  const c = city();
  await c.ready;
  const reg = registry().households[household];
  if (!reg) throw new Error("unknown household");
  const { identity, clock } = cityIdentity();
  const base = { household, source: { type: "console" as const }, lang: reg.lang, note: opts.note?.slice(0, 280) };
  let events: SignedEvent[];
  if (kind === "ack") {
    // A home can have several open calls if the beacon was pressed again. Answer all of them.
    const open = project(c.store.all()).incidents.filter((i) => i.household === household && i.status === "open");
    if (!open.length) throw new Error("no open call for help at this household");
    events = open.map((inc) => createEvent(identity, clock, { ...base, kind: "ack", ref: inc.eventId }));
  } else {
    events = [createEvent(identity, clock, { ...base, kind: "ok" })];
  }
  if (dbEnabled()) await insertEvents(events, identity.id);
  for (const ev of events) {
    c.store.add(ev);
    c.receivedAt.set(ev.id, Date.now());
  }
  emit({ type: "action", kind, household });
  return events[events.length - 1]!;
}

/** Everything the operations room needs, in one serializable object. */
export async function snapshot() {
  const c = city();
  await c.ready;
  const reg = registry();
  const events = c.store.all();
  const p = project(events);
  const statusOf = new Map(p.households.map((h) => [h.household, h]));
  const now = Date.now();
  const households = Object.entries(reg.households).map(([id, h]) => {
    const s = statusOf.get(id);
    return {
      id,
      label: h.label,
      lang: h.lang,
      needs: h.needs.map((n) => ({ id: n, label: NEED_LABELS[n]?.en ?? n })),
      status: s?.status ?? "unknown",
      lastEventAt: s?.lastEventAt ? decodeHlc(s.lastEventAt).wall : null,
      openIncident: s?.openIncident ?? null,
    };
  });
  const incidents = p.incidents.map((i) => ({
    ...i,
    label: reg.households[i.household]?.label ?? i.household,
    openedAtMs: decodeHlc(i.openedAt).wall,
    waitMinutes: Math.max(0, Math.round((now - decodeHlc(i.openedAt).wall) / 60000)),
  }));
  let tl: { source: string; buckets: TimelineBucket[] };
  let hold = { p50: 0, p95: 0, max: 0, n: 0 };
  if (dbEnabled()) {
    try {
      tl = await timeline();
      hold = await holdStats();
    } catch (err) {
      console.error("[city] analytics query failed", (err as Error).message);
      tl = { source: "unavailable", buckets: [] };
    }
  } else {
    const cutoff = now - 60 * 60_000;
    const rows = events
      .filter((e) => decodeHlc(e.hlc).wall > cutoff)
      .map((e) => {
        const d = new Date(decodeHlc(e.hlc).wall);
        d.setSeconds(0, 0);
        return { bucket: d.toISOString(), kind: e.kind, n: 1 };
      });
    tl = { source: "memory", buckets: foldTimeline(rows) };
    const holds = events.map((e) => ((c.receivedAt.get(e.id) ?? now) - decodeHlc(e.hlc).wall) / 1000).sort((a, b) => a - b);
    const q = (x: number) => Math.round(holds[Math.min(holds.length - 1, Math.floor(x * holds.length))] ?? 0);
    hold = { p50: q(0.5), p95: q(0.95), max: Math.round(holds.at(-1) ?? 0), n: holds.length };
  }
  // Provenance for each home: who signed each event, how it reached the city, newest first.
  const nameOf = new Map([...c.nodes.values()].map((n) => [n.id, n.name]));
  const cityId = cityIdentity().identity.id;
  const trail: Record<string, { id: string; kind: string; at: number; by: string; via: string | null; source: string; beacon: string | null }[]> = {};
  for (const e of events) {
    const list = (trail[e.household] ??= []);
    list.push({
      id: e.id.slice(0, 10),
      kind: e.kind,
      at: decodeHlc(e.hlc).wall,
      by: e.origin === cityId ? "the city" : nameOf.get(e.origin) ?? `node ${e.origin.slice(0, 6)}`,
      via: c.deliveredBy.get(e.id) ?? null,
      source: e.source.type,
      beacon: e.source.beacon ?? null,
    });
  }
  for (const k of Object.keys(trail)) trail[k] = trail[k]!.sort((a, b) => b.at - a.at).slice(0, 8);

  return {
    generatedAt: now,
    outage: c.outage,
    trail,
    storage: dbEnabled() ? "tiger-data" : "memory",
    counts: { events: events.length, open: incidents.filter((i) => i.status !== "resolved").length },
    households,
    incidents,
    nodes: [...c.nodes.values()].map((n) => ({ ...n, houseId: reg.nodes[n.name] ?? null })),
    nodeHouses: reg.nodes,
    timeline: tl,
    holdSeconds: hold,
  };
}

export type CitySnapshot = Awaited<ReturnType<typeof snapshot>>;
