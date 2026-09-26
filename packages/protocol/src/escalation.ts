/**
 * Porch Circles escalation: who hears a call first, then the whole street, then the city.
 */
export type EscalationTier = "buddies" | "street" | "city";

export function escalationTier(args: {
  incidentOpenedAt: number;
  acked: boolean;
  now: number;
  buddyWindowSec: number;
  streetWindowSec: number;
}): EscalationTier | null {
  if (args.acked) return null;
  const buddy = Math.max(0, args.buddyWindowSec);
  const street = Math.max(0, args.streetWindowSec);
  const ageSec = Math.max(0, (args.now - args.incidentOpenedAt) / 1000);
  if (ageSec < buddy) return "buddies";
  if (ageSec < buddy + street) return "street";
  return "city";
}
