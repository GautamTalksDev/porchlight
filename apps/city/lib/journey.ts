/**
 * Pure helpers for "the call's journey": how a help event physically reached City Hall.
 */

import { CITY_BROADCAST_HOUSEHOLD } from "@porchlight/protocol";

export const CITY_HALL_ID = CITY_BROADCAST_HOUSEHOLD;
export const CITY_HALL_LABEL = "City Hall";
/** Short holds under this are clock skew / latency, not an outage pause on the map. */
export const HOLD_PAUSE_MS = 3000;

export type JourneyKind = "Bluetooth" | "Neighbour to neighbour" | "To City Hall";

export interface JourneyHop {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  kind: JourneyKind;
  /** Milliseconds the call waited offline at the hop's street end before continuing. */
  heldMs?: number;
}

export interface BuildJourneyInput {
  event: { household: string; source: { type: string } };
  /** Label for the calling home. */
  householdLabel: string;
  /** Node name that signed the event (who first heard it). */
  originNode: string | null;
  /** Node name that delivered the event to the city. */
  deliveredBy: string | null;
  /** How long the event waited offline before the city received it, in ms. */
  heldMs?: number | null;
  /** Node name → household id. Missing entries skip that hop. */
  nodeHouseholds: Record<string, string>;
  /** Household id → display label. */
  householdLabels: Record<string, string>;
}

function labelOf(id: string, labels: Record<string, string>): string {
  if (id === CITY_HALL_ID) return CITY_HALL_LABEL;
  return labels[id] ?? id;
}

/**
 * Ordered hops from the calling home to City Hall.
 * Skips hops whose node household is unknown; never throws.
 */
export function buildJourney(input: BuildJourneyInput): JourneyHop[] {
  const hops: JourneyHop[] = [];
  const labels = input.householdLabels;
  let cursor = input.event.household;
  let cursorLabel = input.householdLabel || labelOf(cursor, labels);

  const originHome = input.originNode ? input.nodeHouseholds[input.originNode] : undefined;
  const deliverHome = input.deliveredBy ? input.nodeHouseholds[input.deliveredBy] : undefined;

  if (input.event.source.type === "beacon" && originHome) {
    if (originHome !== cursor) {
      hops.push({
        fromId: cursor,
        toId: originHome,
        fromLabel: cursorLabel,
        toLabel: labelOf(originHome, labels),
        kind: "Bluetooth",
      });
      cursor = originHome;
      cursorLabel = labelOf(originHome, labels);
    }
  }

  if (input.deliveredBy && input.originNode && input.deliveredBy !== input.originNode && deliverHome) {
    if (deliverHome !== cursor) {
      hops.push({
        fromId: cursor,
        toId: deliverHome,
        fromLabel: cursorLabel,
        toLabel: labelOf(deliverHome, labels),
        kind: "Neighbour to neighbour",
      });
      cursor = deliverHome;
      cursorLabel = labelOf(deliverHome, labels);
    }
  }

  hops.push({
    fromId: cursor,
    toId: CITY_HALL_ID,
    fromLabel: cursorLabel,
    toLabel: CITY_HALL_LABEL,
    kind: "To City Hall",
  });

  const held = input.heldMs ?? 0;
  if (held >= HOLD_PAUSE_MS) {
    let attached = false;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const hop = hops[i]!;
      if (hop.toId !== CITY_HALL_ID) {
        hop.heldMs = held;
        attached = true;
        break;
      }
    }
    if (!attached) hops[hops.length - 1]!.heldMs = held;
  }

  return hops;
}

/** Text breadcrumb for the detail panel (uses the same heldMs gate as the map pause). */
export function formatJourneyBreadcrumb(hops: JourneyHop[]): string {
  if (!hops.length) return "";
  const parts: string[] = [hops[0]!.fromLabel];
  for (const hop of hops) {
    parts.push(hop.kind === "Neighbour to neighbour" ? "neighbour to neighbour" : hop.kind);
    if (hop.kind !== "To City Hall") parts.push(hop.toLabel);
    if (hop.heldMs != null && hop.heldMs >= HOLD_PAUSE_MS) {
      const secs = Math.max(1, Math.round(hop.heldMs / 1000));
      parts.push(`held ${secs} s during the outage`);
    }
  }
  return parts.join(", ");
}
