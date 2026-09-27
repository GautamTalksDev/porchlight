/**
 * Pure helpers for the operations room arrival banner.
 * Open and acknowledged new incidents both get a moment; acknowledged ones are moonlight, not signal red.
 */
import { HOLD_PAUSE_MS } from "./journey";

export interface ArrivalIncident {
  key: string;
  household: string;
  label: string;
  status: "open" | "acknowledged" | "resolved";
  note?: string | null;
  neighbourThread?: readonly { actorLabel: string; replyCode: string; replyLabel: string }[];
}

/** Newly seen incidents that should fire the arrival moment (not resolved). */
export function selectNewArrivals(known: ReadonlySet<string>, incidents: readonly ArrivalIncident[]): ArrivalIncident[] {
  return incidents.filter((i) => (i.status === "open" || i.status === "acknowledged") && !known.has(i.key));
}

export function journeyHasHeldHop(hops: readonly { heldMs?: number }[]): boolean {
  return hops.some((h) => h.heldMs != null && h.heldMs >= HOLD_PAUSE_MS);
}

/** Latest neighbour who replied On my way, or null. */
export function latestOmwActor(
  thread: readonly { actorLabel: string; replyCode: string }[] | null | undefined,
): string | null {
  if (!thread?.length) return null;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i]!.replyCode === "omw") return thread[i]!.actorLabel;
  }
  return null;
}

export interface ArrivalBannerCopy {
  answered: boolean;
  kicker: string;
  /** Line under the name for answered calls; null for open calls. */
  detail: string | null;
}

export function arrivalBannerCopy(input: {
  status: "open" | "acknowledged";
  fall: boolean;
  heldDuringOutage: boolean;
  latestOmwLabel: string | null;
}): ArrivalBannerCopy {
  if (input.status === "acknowledged") {
    return {
      answered: true,
      kicker: input.heldDuringOutage ? "Held during the outage" : "Call received",
      detail: input.latestOmwLabel
        ? `${input.latestOmwLabel} is already on the way`
        : "A neighbour is already on the way",
    };
  }
  return {
    answered: false,
    kicker: input.fall ? "Possible fall detected" : "New call for help",
    detail: null,
  };
}
