/**
 * Pure ingest classification shared by the city ingest path and its tests.
 * A valid signed event of any protocol kind (including reply) is accepted;
 * there is no kind whitelist here.
 */
import { verifyEvent, type SignedEvent } from "@porchlight/protocol";

export type IngestVerdict =
  | { status: "accepted"; event: SignedEvent }
  | { status: "duplicate"; id: string }
  | { status: "rejected"; id: string; reason: string };

/** Classify one raw ingest item the same way the city does before storage. */
export function classifyIngestItem(item: unknown, alreadyHas: (id: string) => boolean): IngestVerdict {
  const id = String((item as { id?: unknown })?.id ?? "").slice(0, 64);
  if (alreadyHas(id)) return { status: "duplicate", id };
  const v = verifyEvent(item);
  if (!v.ok) return { status: "rejected", id, reason: v.reason };
  return { status: "accepted", event: v.event };
}
