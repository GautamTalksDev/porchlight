/**
 * City event store and notice broadcast helpers shared by the city runtime and tests.
 * Notices use household city-hall; the store must pin cityOrigin so they verify and persist.
 */

import {
  EventStore,
  CITY_BROADCAST_HOUSEHOLD,
  compareHlc,
  createEvent,
  decodeHlc,
  type HybridClock,
  type NodeIdentity,
  type NoticePayload,
  type SignedEvent,
} from "@porchlight/protocol";
import { noticeReachStats } from "./notice-delivery";

/** EventStore that accepts city-signed notices (and rejects forged ones). */
export function createCityEventStore(cityId: string): EventStore {
  return new EventStore(undefined, () => ({ cityOrigin: cityId }));
}

/** City-origin events a node should pull down and gossip. Oldest first, last 24 hours, at most 200. */
export function cityEventsDownlink(events: SignedEvent[], cityId: string, now = Date.now()): SignedEvent[] {
  const cutoff = now - 24 * 60 * 60_000;
  return events
    .filter((e) => e.origin === cityId && decodeHlc(e.hlc).wall >= cutoff)
    .sort((a, b) => compareHlc(a.hlc, b.hlc))
    .slice(0, 200);
}

export interface NoticeView {
  id: string;
  en: string;
  fr: string;
  severity: NoticePayload["severity"];
  at: number;
  reachedNodes: number;
  totalNodes: number;
}

/** Build the ops room Sent list from stored events. city-hall notices stay here; they are not homes. */
export function noticesFromEvents(
  events: SignedEvent[],
  cityId: string,
  confirmations: Map<string, Set<string>>,
  totalNodes: number,
): NoticeView[] {
  const cityNoticeEvents = events
    .filter((e) => e.kind === "notice" && e.origin === cityId && e.notice)
    .sort((a, b) => decodeHlc(b.hlc).wall - decodeHlc(a.hlc).wall);
  const reachById = new Map(
    noticeReachStats(
      cityNoticeEvents.map((e) => e.id),
      confirmations,
      totalNodes,
    ).map((r) => [r.noticeId, r]),
  );
  return cityNoticeEvents.map((e) => {
    const reach = reachById.get(e.id);
    return {
      id: e.id,
      en: e.notice!.en,
      fr: e.notice!.fr,
      severity: e.notice!.severity,
      at: decodeHlc(e.hlc).wall,
      reachedNodes: reach?.reachedNodes ?? 0,
      totalNodes: reach?.totalNodes ?? totalNodes,
    };
  });
}

/**
 * Sign and store a notice. Returns the event. Throws if the store rejects it
 * (for example when cityOrigin is missing on the store).
 */
export function storeSignedNotice(
  store: EventStore,
  identity: NodeIdentity,
  clock: HybridClock,
  notice: NoticePayload,
): SignedEvent {
  const ev = createEvent(identity, clock, {
    kind: "notice",
    household: CITY_BROADCAST_HOUSEHOLD,
    notice,
    source: { type: "console" },
  });
  const r = store.add(ev);
  if (!r.added && r.reason !== "duplicate") {
    throw new Error(`could not store notice: ${r.reason}`);
  }
  return ev;
}
