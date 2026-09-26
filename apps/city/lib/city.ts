import "server-only";
import {
  EventStore,
  REPLY_LABELS,
  CITY_BROADCAST_HOUSEHOLD,
  compareHlc,
  createEvent,
  decodeHlc,
  escalationTier,
  project,
  type NoticePayload,
  type SignedEvent,
} from "@porchlight/protocol";
import { decideAck, VOICE_ESCALATION_NOTE } from "./ack-decision";
import { buildNeighbourThread, circleWindows } from "./circles";
import { dbEnabled, foldTimeline, getSetting, holdStats, insertEvents, loadAllEvents, recordDelivery, setSetting, timeline, clearDemoTables, type TimelineBucket } from "./db";
import { cityIdentity } from "./identity";
import { classifyIngestItem } from "./ingest-verify";
import { noticeReachStats, recordNoticeConfirmations } from "./notice-delivery";
import { NEED_LABELS, registry } from "./registry";
import { computeSilent } from "./silence";
import { shouldSkipAnalytics } from "./analytics-backoff";

export interface NodeSeen {
  id: string;
  name: string;
  lastSeenAt: number;
  delivered: number;
}

export type CityMessage =
  | { type: "delivery"; node: { id: string; name: string }; events: Pick<SignedEvent, "id" | "kind" | "household" | "origin" | "incident">[] }
  | { type: "outage"; down: boolean }
  | { type: "emergency"; since: number | null }
  | { type: "action"; kind: string; household: string }
  | { type: "reset" };

interface CityState {
  ready: Promise<void>;
  store: EventStore;
  nodes: Map<string, NodeSeen>;
  receivedAt: Map<string, number>;
  deliveredBy: Map<string, string>;
  outage: boolean;
  emergencySince: number | null;
  listeners: Set<(m: CityMessage) => void>;
  /** Wall clock when analytics last failed; used to skip retries for 30 seconds. */
  analyticsFailedAt: number | null;
  /** Per notice id, which node ids have confirmed they hold it. */
  noticeConfirmations: Map<string, Set<string>>;
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
    emergencySince: null,
    listeners: new Set(),
    analyticsFailedAt: null,
    noticeConfirmations: new Map(),
  };
  state.ready = (async () => {
    if (!dbEnabled()) return;
    try {
      for (const raw of await loadAllEvents()) state.store.add(raw);
      state.outage = (await getSetting<boolean>("outage")) ?? false;
      state.emergencySince = (await getSetting<number | null>("emergencySince")) ?? null;
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
  /** City-signed decisions for the street: oldest first, last 24 hours, at most 200. */
  cityEvents: SignedEvent[];
  /** City signing origin id; nodes pin this and only accept notices from it. */
  cityId: string;
}

/** City-origin events the node should pull down and gossip to neighbours. */
function cityEventsDownlink(): SignedEvent[] {
  const c = city();
  const cityId = cityIdentity().identity.id;
  const cutoff = Date.now() - 24 * 60 * 60_000;
  return c.store
    .all()
    .filter((e) => e.origin === cityId && decodeHlc(e.hlc).wall >= cutoff)
    .sort((a, b) => compareHlc(a.hlc, b.hlc))
    .slice(0, 200);
}

function knownNoticeIds(c: CityState): Set<string> {
  const cityId = cityIdentity().identity.id;
  return new Set(c.store.all().filter((e) => e.kind === "notice" && e.origin === cityId).map((e) => e.id));
}

/**
 * Accept a batch from a node. Every event is verified before it is stored, and it is written to
 * Tiger Data before it is acknowledged, so a node only forgets an event once it is durable here.
 */
export async function ingest(
  node: { id: string; name: string },
  raw: unknown[],
  heldNoticeIds: string[] = [],
): Promise<IngestResult> {
  const c = city();
  await c.ready;
  const cityId = cityIdentity().identity.id;
  const result: IngestResult = { accepted: [], duplicates: [], rejected: [], cityEvents: [], cityId };
  const fresh: SignedEvent[] = [];
  for (const item of raw) {
    const verdict = classifyIngestItem(item, (id) => c.store.has(id));
    if (verdict.status === "duplicate") {
      result.duplicates.push(verdict.id);
      continue;
    }
    if (verdict.status === "rejected") {
      result.rejected.push({ id: verdict.id, reason: verdict.reason });
      continue;
    }
    if (verdict.event.kind === "notice" && verdict.event.origin !== cityId) {
      result.rejected.push({ id: verdict.event.id, reason: "notice not signed by the City" });
      continue;
    }
    fresh.push(verdict.event);
  }
  // Several nodes often deliver the same event at the same moment. The database decides who was
  // first (ON CONFLICT DO NOTHING); every other copy counts as a duplicate, not a delivery.
  const inserted = dbEnabled() && fresh.length ? await insertEvents(fresh, node.id) : null; // throws: node keeps its events and retries
  const delivered: SignedEvent[] = [];
  for (const ev of fresh) {
    if ((inserted && !inserted.has(ev.id)) || c.store.has(ev.id)) {
      result.duplicates.push(ev.id);
      continue;
    }
    c.store.add(ev);
    c.receivedAt.set(ev.id, Date.now());
    c.deliveredBy.set(ev.id, node.name);
    result.accepted.push(ev.id);
    delivered.push(ev);
  }
  const seen = c.nodes.get(node.id) ?? { id: node.id, name: node.name, lastSeenAt: 0, delivered: 0 };
  seen.lastSeenAt = Date.now();
  seen.delivered += result.accepted.length;
  seen.name = node.name;
  c.nodes.set(node.id, seen);
  recordNoticeConfirmations(c.noticeConfirmations, node.id, heldNoticeIds, knownNoticeIds(c));
  if (dbEnabled() && (raw.length || result.rejected.length)) {
    recordDelivery(node.id, node.name, result.accepted.length, result.duplicates.length, result.rejected.length).catch(() => {});
  }
  if (delivered.length) {
    emit({ type: "delivery", node, events: delivered.map((e) => ({ id: e.id, kind: e.kind, household: e.household, origin: e.origin, incident: e.incident })) });
  }
  result.cityEvents = cityEventsDownlink();
  return result;
}

export async function setOutage(down: boolean): Promise<void> {
  const c = city();
  c.outage = down;
  if (dbEnabled()) await setSetting("outage", down).catch((e) => console.error("[city] outage setting not saved", e.message));
  emit({ type: "outage", down });
}

/** Start or end the emergency clock used for proactive wellness checks. */
export async function setEmergency(active: boolean): Promise<number | null> {
  const c = city();
  c.emergencySince = active ? Date.now() : null;
  if (dbEnabled()) {
    await setSetting("emergencySince", c.emergencySince).catch((e) => console.error("[city] emergency setting not saved", e.message));
  }
  emit({ type: "emergency", since: c.emergencySince });
  return c.emergencySince;
}

/**
 * Wipe demo state for a clean rehearsal. Clears events in memory and (when enabled) in Tiger Data.
 * Does not touch the city signing identity.
 */
export async function resetDemo(): Promise<void> {
  const c = city();
  await c.ready;
  c.store = new EventStore();
  c.nodes.clear();
  c.receivedAt.clear();
  c.deliveredBy.clear();
  c.outage = false;
  c.emergencySince = null;
  c.analyticsFailedAt = null;
  c.noticeConfirmations.clear();
  if (dbEnabled()) {
    await clearDemoTables();
    await setSetting("outage", false);
    await setSetting("emergencySince", null);
  }
  emit({ type: "reset" });
}

/** Broadcast a bilingual notice signed by the city. Stored like other city events for downlink. */
export async function publishNotice(notice: NoticePayload): Promise<SignedEvent> {
  const c = city();
  await c.ready;
  const { identity, clock } = cityIdentity();
  const ev = createEvent(identity, clock, {
    kind: "notice",
    household: CITY_BROADCAST_HOUSEHOLD,
    notice,
    source: { type: "console" },
  });
  if (dbEnabled()) await insertEvents([ev], identity.id);
  c.store.add(ev);
  c.receivedAt.set(ev.id, Date.now());
  c.noticeConfirmations.set(ev.id, new Set());
  emit({ type: "action", kind: "notice", household: CITY_BROADCAST_HOUSEHOLD });
  return ev;
}

/** A coordinator or the voice agent acts on a household. Signed with the city's own key. */
export async function cityAction(kind: "ok" | "ack", household: string, opts: { incident?: string; note?: string } = {}): Promise<SignedEvent | null> {
  const c = city();
  await c.ready;
  const reg = registry().households[household];
  if (!reg) throw new Error("unknown household");
  const { identity, clock } = cityIdentity();
  const base = { household, source: { type: "console" as const }, lang: reg.lang, note: opts.note?.slice(0, 280) };
  let events: SignedEvent[];
  if (kind === "ack") {
    const decision = decideAck(project(c.store.all()).incidents, household);
    if (decision.action === "already") return null;
    if (decision.action === "ack") {
      // A home can have several open calls if the beacon was pressed again. Answer all of them.
      events = decision.eventIds.map((ref) => createEvent(identity, clock, { ...base, kind: "ack", ref }));
    } else {
      // No open card: open a city call for help and dispatch (voice check-in or silent wellness).
      const helpNote = opts.note?.trim() || VOICE_ESCALATION_NOTE;
      const help = createEvent(identity, clock, {
        household,
        source: { type: "console" },
        lang: reg.lang,
        kind: "help",
        incident: `voice-${identity.id}-${Date.now().toString(36)}`,
        note: helpNote.slice(0, 280),
      });
      const ack = createEvent(identity, clock, { ...base, kind: "ack", ref: help.id });
      events = [help, ack];
    }
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
  const { buddyWindowSec, streetWindowSec } = circleWindows();
  const labelOf = (id: string) => reg.households[id]?.label ?? id;
  const incidents = p.incidents.map((i) => {
    const openedAtMs = decodeHlc(i.openedAt).wall;
    const buddyIds = (reg.households[i.household]?.buddies ?? []).filter((id) => reg.households[id]);
    const tier = escalationTier({
      incidentOpenedAt: openedAtMs,
      acked: i.status !== "open",
      now,
      buddyWindowSec,
      streetWindowSec,
    });
    return {
      ...i,
      label: labelOf(i.household),
      openedAtMs,
      waitMinutes: Math.max(0, Math.round((now - openedAtMs) / 60000)),
      tier,
      buddies: buddyIds.map((id) => ({ id, label: labelOf(id) })),
      neighbourThread: buildNeighbourThread(i.replies, labelOf),
    };
  });
  let tl: { source: string; buckets: TimelineBucket[] };
  let hold = { p50: 0, p95: 0, max: 0, n: 0 };
  if (dbEnabled()) {
    if (shouldSkipAnalytics(c.analyticsFailedAt, now)) {
      tl = { source: "paused", buckets: [] };
    } else {
      try {
        tl = await timeline();
        hold = await holdStats();
        c.analyticsFailedAt = null;
      } catch (err) {
        console.error("[city] analytics query failed", (err as Error).message);
        c.analyticsFailedAt = now;
        tl = { source: "paused", buckets: [] };
      }
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
  const trail: Record<string, { id: string; kind: string; at: number; by: string; via: string | null; source: string; beacon: string | null; note: string | null }[]> = {};
  for (const e of events) {
    const list = (trail[e.household] ??= []);
    let note: string | null = e.note ?? null;
    if (e.kind === "reply" && e.reply) {
      const label = REPLY_LABELS[e.reply];
      note = e.note ? `${label}. ${e.note}` : label;
    }
    list.push({
      id: e.id.slice(0, 10),
      kind: e.kind,
      at: decodeHlc(e.hlc).wall,
      by: e.origin === cityId ? "the city" : nameOf.get(e.origin) ?? `node ${e.origin.slice(0, 6)}`,
      via: c.deliveredBy.get(e.id) ?? null,
      source: e.source.type,
      beacon: e.source.beacon ?? null,
      note,
    });
  }
  for (const k of Object.keys(trail)) trail[k] = trail[k]!.sort((a, b) => b.at - a.at).slice(0, 8);

  const thresholdMinutes = Math.max(1, Number(process.env.SILENCE_MINUTES) || 30);
  const lastHeardAt: Record<string, number | null> = {};
  for (const h of households) lastHeardAt[h.id] = h.lastEventAt;
  const silent = computeSilent({
    households: Object.entries(reg.households).map(([id, h]) => ({ id, label: h.label, lang: h.lang, needs: h.needs })),
    lastHeardAt,
    emergencySince: c.emergencySince,
    now,
    thresholdMinutes,
  });

  const cityNoticeIds = events.filter((e) => e.kind === "notice" && e.origin === cityId).map((e) => e.id);
  const totalNodes = Math.max(Object.keys(reg.nodes).length, 1);
  const noticeDelivery = noticeReachStats(cityNoticeIds, c.noticeConfirmations, totalNodes);

  return {
    generatedAt: now,
    outage: c.outage,
    emergencySince: c.emergencySince,
    silent,
    trail,
    storage: dbEnabled() ? "tiger-data" : "memory",
    counts: { events: events.length, open: incidents.filter((i) => i.status !== "resolved").length },
    households,
    incidents,
    nodes: [...c.nodes.values()].map((n) => ({ ...n, houseId: reg.nodes[n.name] ?? null })),
    nodeHouses: reg.nodes,
    timeline: tl,
    holdSeconds: hold,
    noticeDelivery,
  };
}

export type CitySnapshot = Awaited<ReturnType<typeof snapshot>>;
