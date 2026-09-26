/**
 * Pure helpers for the operations room preflight panel.
 */

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PreflightSummary {
  ok: boolean;
  passed: number;
  total: number;
}

/** Green only when every check passes. */
export function summarizePreflight(checks: PreflightCheck[]): PreflightSummary {
  const total = checks.length;
  const passed = checks.filter((c) => c.ok).length;
  return { ok: total > 0 && passed === total, passed, total };
}
