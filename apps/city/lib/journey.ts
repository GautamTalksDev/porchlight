/**
 * Pure helpers for "the call's journey": how a help event physically reached City Hall.
 * Kept free of server-only and Node built-ins so the ops room client can import it safely.
 */

/** Same slug as CITY_BROADCAST_HOUSEHOLD in the protocol package. */
export const CITY_HALL_ID = "city-hall";
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

export interface TrailEntryForJourney {
  kind: string;
  by: string;
  via: string | null;
  source: string;
  heldMs?: number;
}

function labelOf(id: string, labels: Record<string, string>): string {
  if (id === CITY_HALL_ID) return CITY_HALL_LABEL;
  return labels[id] ?? id;
}

/**
 * Merge registry node homes with live ingest reports.
 * Live household wins when a node sent NODE_HOUSEHOLD; otherwise the registry fills the gap.
 */
export function resolveNodeHouseholds(input: {
  registryNodes: Record<string, string>;
  liveNodes?: { name: string; household?: string | null; houseId?: string | null }[];
}): Record<string, string> {
  const out: Record<string, string> = { ...input.registryNodes };
  for (const n of input.liveNodes ?? []) {
    const home = n.household || n.houseId || out[n.name];
    if (home) out[n.name] = home;
  }
  return out;
}

/** Turn a trail "by" / "via" label into a node name that exists in nodeHouseholds when possible. */
export function resolveTrailNodeName(
  label: string | null | undefined,
  nodeHouseholds: Record<string, string>,
  nodes?: { id: string; name: string }[],
): string | null {
  if (!label || label === "the city") return null;
  if (nodeHouseholds[label]) return label;
  if (label.startsWith("node ") && nodes?.length) {
    const prefix = label.slice(5);
    const hit = nodes.find((n) => n.id.startsWith(prefix));
    if (hit) return hit.name;
  }
  // Pass through names the registry may still know once households are merged.
  return label;
}

/**
 * Build hops from a household's trust trail (and optional open-call fallback).
 * Any call with a resolvable trail entry always gets at least the hops that can be built.
 */
export function journeyFromTrail(input: {
  householdId: string;
  householdLabel: string;
  trail: TrailEntryForJourney[];
  nodeHouseholds: Record<string, string>;
  householdLabels: Record<string, string>;
  nodes?: { id: string; name: string }[];
  /** When trail is empty but this home has an open call, still return a City Hall hop. */
  hasOpenCall?: boolean;
}): JourneyHop[] {
  const help =
    input.trail.find((t) => t.kind === "help") ??
    input.trail.find((t) => t.source === "beacon") ??
    input.trail[0];

  if (!help) {
    if (!input.hasOpenCall) return [];
    return buildJourney({
      event: { household: input.householdId, source: { type: "console" } },
      householdLabel: input.householdLabel,
      originNode: null,
      deliveredBy: null,
      nodeHouseholds: input.nodeHouseholds,
      householdLabels: input.householdLabels,
    });
  }

  const originNode = resolveTrailNodeName(help.by, input.nodeHouseholds, input.nodes);
  const deliveredBy =
    resolveTrailNodeName(help.via, input.nodeHouseholds, input.nodes) ?? originNode;

  return buildJourney({
    event: { household: input.householdId, source: { type: help.source || "console" } },
    householdLabel: input.householdLabel,
    originNode,
    deliveredBy,
    heldMs: help.heldMs,
    nodeHouseholds: input.nodeHouseholds,
    householdLabels: input.householdLabels,
  });
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
