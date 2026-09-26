/**
 * Pure helpers for city notice delivery tracking (proof of delivery).
 */

export interface NoticeReachRow {
  noticeId: string;
  reachedNodes: number;
  totalNodes: number;
}

/**
 * For each notice id, count how many distinct nodes have confirmed holding it.
 * totalNodes is the expected neighbourhood size (from the registry).
 */
export function noticeReachStats(
  noticeIds: string[],
  confirmations: Map<string, Set<string>>,
  totalNodes: number,
): NoticeReachRow[] {
  const total = Math.max(0, totalNodes);
  return noticeIds.map((noticeId) => ({
    noticeId,
    reachedNodes: confirmations.get(noticeId)?.size ?? 0,
    totalNodes: total,
  }));
}

/** Record that a node holds the given notice ids. Mutates confirmations. */
export function recordNoticeConfirmations(
  confirmations: Map<string, Set<string>>,
  nodeId: string,
  heldNoticeIds: string[],
  knownNoticeIds: ReadonlySet<string>,
): void {
  for (const id of heldNoticeIds) {
    if (!knownNoticeIds.has(id)) continue;
    const set = confirmations.get(id) ?? new Set<string>();
    set.add(nodeId);
    confirmations.set(id, set);
  }
}
