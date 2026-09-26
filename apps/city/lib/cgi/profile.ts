/**
 * Column profiling for a CSV the team loads by hand. Runs in the browser tab only.
 * No AI, no network: this module must never import an AI SDK or call fetch (enforced by test/ai-firewall.test.ts).
 */

export type Row = Record<string, string>;

export interface ColumnProfile {
  name: string;
  filled: number;
  distinct: number;
  top: { value: string; count: number }[];
}

export function profileColumns(rows: Row[], topN = 40): ColumnProfile[] {
  if (!rows.length) return [];
  const names = Object.keys(rows[0]!);
  return names.map((name) => {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of rows) {
      const v = (r[name] ?? "").trim();
      if (!v) continue;
      filled++;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([value, count]) => ({ value, count }));
    return { name, filled, distinct: counts.size, top };
  });
}

/** Share of rows whose value in `column` is one of `selected`. */
export function shareOf(rows: Row[], column: string, selected: ReadonlySet<string>): { matched: number; total: number; share: number } {
  let matched = 0;
  let total = 0;
  for (const r of rows) {
    const v = (r[column] ?? "").trim();
    if (!v) continue;
    total++;
    if (selected.has(v)) matched++;
  }
  return { matched, total, share: total ? matched / total : 0 };
}

/** Rows per year, from the earliest and latest parseable date in a column. */
export function annualized(rows: Row[], dateColumn: string): { perYear: number; from: string; to: string } | null {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const r of rows) {
    const t = Date.parse((r[dateColumn] ?? "").trim());
    if (Number.isNaN(t)) continue;
    n++;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (n < 2 || max <= min) return null;
  const years = (max - min) / (365.25 * 24 * 3600 * 1000);
  return { perYear: n / years, from: new Date(min).toISOString().slice(0, 10), to: new Date(max).toISOString().slice(0, 10) };
}
