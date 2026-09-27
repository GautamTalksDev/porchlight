/**
 * Shared loader: snapshot to Open311 requests for the GeoReport v2 routes.
 */
import "server-only";
import { decodeHlc } from "@porchlight/protocol";
import { snapshot } from "./city";
import { buildOpen311Requests, type Open311Request } from "./open311";

export async function loadOpen311Requests(): Promise<Open311Request[]> {
  const snap = await snapshot();
  const needsOf = (householdId: string) =>
    (snap.households.find((h) => h.id === householdId)?.needs ?? []).map((n) => n.id);

  return buildOpen311Requests({
    incidents: snap.incidents.map((i) => ({
      key: i.key,
      household: i.household,
      label: i.label,
      status: i.status === "acknowledged" ? "acknowledged" : i.status === "resolved" ? "resolved" : "open",
      openedAtMs: i.openedAtMs,
      ackAtMs: i.ackAt ? decodeHlc(i.ackAt).wall : null,
      resolvedAtMs: i.resolvedAt ? decodeHlc(i.resolvedAt).wall : null,
      needs: needsOf(i.household),
      tier: i.tier ?? null,
      note: i.note ?? null,
    })),
    silent: snap.silent.map((s) => ({
      household: s.household,
      label: s.label,
      needs: needsOf(s.household),
      minutesSilent: s.minutesSilent,
    })),
    powerOut: snap.households
      .filter((h) => h.powerOut)
      .map((h) => ({
        household: h.id,
        label: h.label,
        needs: h.needs.map((n) => n.id),
      })),
    emergencySince: snap.emergencySince,
    now: snap.generatedAt,
  });
}
