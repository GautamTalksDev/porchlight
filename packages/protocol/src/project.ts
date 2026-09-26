import { compareHlc } from "./hlc";
import type { ReplyCode, SignedEvent } from "./event";

export type IncidentStatus = "open" | "acknowledged" | "resolved";
export type HouseholdStatus = "unknown" | "ok" | "help" | "acknowledged";

export interface IncidentReply {
  id: string;
  at: string;
  origin: string;
  actor: string;
  reply: ReplyCode;
  note?: string;
}

export interface Incident {
  key: string;
  household: string;
  eventId: string;
  openedAt: string;
  status: IncidentStatus;
  /** Node ids that independently heard this alert. More than one is corroboration. */
  witnesses: string[];
  bestRssi?: number;
  ackBy?: string;
  ackAt?: string;
  resolvedAt?: string;
  lang?: "en" | "fr";
  note?: string;
  replies: IncidentReply[];
}

export interface HouseholdView {
  household: string;
  status: HouseholdStatus;
  lastEventAt: string;
  openIncident?: string;
}

export interface Projection {
  incidents: Incident[];
  households: HouseholdView[];
}

/** Deterministic view derived from the event set. Same events in, same view out, on every node. */
export function project(events: readonly SignedEvent[]): Projection {
  const sorted = [...events].sort((a, b) => compareHlc(a.hlc, b.hlc));
  const incidents = new Map<string, Incident>();
  const byEventId = new Map<string, Incident>();
  const households = new Map<string, HouseholdView>();

  const hh = (id: string, at: string): HouseholdView => {
    let h = households.get(id);
    if (!h) {
      h = { household: id, status: "unknown", lastEventAt: at };
      households.set(id, h);
    }
    h.lastEventAt = at;
    return h;
  };

  for (const ev of sorted) {
    switch (ev.kind) {
      case "help": {
        const key = ev.incident!;
        let inc = incidents.get(key);
        if (!inc) {
          inc = {
            key,
            household: ev.household,
            eventId: ev.id,
            openedAt: ev.hlc,
            status: "open",
            witnesses: [],
            lang: ev.lang,
            note: ev.note,
            replies: [],
          };
          incidents.set(key, inc);
        }
        byEventId.set(ev.id, inc);
        if (!inc.witnesses.includes(ev.origin)) inc.witnesses.push(ev.origin);
        if (ev.source.rssi !== undefined) inc.bestRssi = Math.max(inc.bestRssi ?? -127, ev.source.rssi);
        const h = hh(ev.household, ev.hlc);
        if (inc.status !== "resolved") {
          h.status = inc.status === "acknowledged" ? "acknowledged" : "help";
          h.openIncident = key;
        }
        break;
      }
      case "ack": {
        const inc = byEventId.get(ev.ref!) ?? [...incidents.values()].find((i) => i.eventId === ev.ref);
        if (inc && inc.status === "open") {
          inc.status = "acknowledged";
          inc.ackBy = ev.origin;
          inc.ackAt = ev.hlc;
          const h = hh(inc.household, ev.hlc);
          if (h.openIncident === inc.key) h.status = "acknowledged";
        }
        break;
      }
      case "ok": {
        const h = hh(ev.household, ev.hlc);
        for (const inc of incidents.values()) {
          if (inc.household === ev.household && inc.status !== "resolved" && compareHlc(inc.openedAt, ev.hlc) < 0) {
            inc.status = "resolved";
            inc.resolvedAt = ev.hlc;
          }
        }
        h.status = "ok";
        delete h.openIncident;
        break;
      }
      case "note":
        hh(ev.household, ev.hlc);
        break;
      case "reply": {
        const inc =
          byEventId.get(ev.ref!) ??
          (ev.incident ? incidents.get(ev.incident) : undefined) ??
          [...incidents.values()].find((i) => i.eventId === ev.ref);
        hh(ev.household, ev.hlc);
        if (inc && ev.reply && ev.actor) {
          if (!inc.replies.some((r) => r.id === ev.id)) {
            inc.replies.push({
              id: ev.id,
              at: ev.hlc,
              origin: ev.origin,
              actor: ev.actor,
              reply: ev.reply,
              note: ev.note,
            });
          }
        }
        break;
      }
    }
  }

  const rank: Record<HouseholdStatus, number> = { help: 0, acknowledged: 1, unknown: 2, ok: 3 };
  return {
    incidents: [...incidents.values()].sort((a, b) => compareHlc(b.openedAt, a.openedAt)),
    households: [...households.values()].sort(
      (a, b) => rank[a.status] - rank[b.status] || a.household.localeCompare(b.household),
    ),
  };
}
