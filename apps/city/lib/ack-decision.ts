/**
 * Pure decision for a city dispatch (ack): open calls first, then already on the way, else escalate.
 * Used by cityAction and unit tested without the city store.
 */

export type AckHouseholdIncident = {
  household: string;
  status: string;
  eventId: string;
};

export type AckDecision =
  | { action: "ack"; eventIds: string[] }
  | { action: "already" }
  | { action: "escalate" };

export const VOICE_ESCALATION_NOTE = "Requested during a voice check-in";

/** Decide how a city ack should proceed for one household. */
export function decideAck(incidents: AckHouseholdIncident[], household: string): AckDecision {
  const atHome = incidents.filter((i) => i.household === household);
  const open = atHome.filter((i) => i.status === "open");
  if (open.length) return { action: "ack", eventIds: open.map((i) => i.eventId) };
  if (atHome.some((i) => i.status === "acknowledged")) return { action: "already" };
  return { action: "escalate" };
}
