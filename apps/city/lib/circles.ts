/**
 * Porch Circles helpers for the city: escalation windows and neighbour reply threads.
 */
import { decodeHlc, REPLY_LABELS, type EscalationTier, type IncidentReply, type ReplyCode } from "@porchlight/protocol";

export interface NeighbourReplyView {
  actorLabel: string;
  replyCode: ReplyCode;
  replyLabel: string;
  note?: string;
  atMs: number;
}

/** Same defaults as the node: 300 seconds each unless overridden. */
export function circleWindows(): { buddyWindowSec: number; streetWindowSec: number } {
  return {
    buddyWindowSec: Math.max(1, Number(process.env.BUDDY_WINDOW_SEC) || 300),
    streetWindowSec: Math.max(1, Number(process.env.STREET_WINDOW_SEC) || 300),
  };
}

/**
 * Build the neighbour reply thread for one incident, oldest first.
 * Labels come from the registry; reply codes become human text via REPLY_LABELS.
 */
export function buildNeighbourThread(
  replies: IncidentReply[],
  labelOf: (householdId: string) => string,
): NeighbourReplyView[] {
  return [...replies]
    .sort((a, b) => decodeHlc(a.at).wall - decodeHlc(b.at).wall)
    .map((r) => ({
      actorLabel: labelOf(r.actor),
      replyCode: r.reply,
      replyLabel: REPLY_LABELS[r.reply],
      note: r.note,
      atMs: decodeHlc(r.at).wall,
    }));
}

export type { EscalationTier };
