/**
 * Pure helpers for analytics query backoff when the database is unreachable.
 */
export const ANALYTICS_COOLDOWN_MS = 30_000;

/** True while we should skip analytics queries after a failure. */
export function shouldSkipAnalytics(
  failedAtMs: number | null,
  nowMs: number,
  cooldownMs: number = ANALYTICS_COOLDOWN_MS,
): boolean {
  if (failedAtMs == null) return false;
  return nowMs - failedAtMs < cooldownMs;
}
