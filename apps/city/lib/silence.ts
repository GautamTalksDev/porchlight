/**
 * Silence is a signal: during an emergency, vulnerable homes that go quiet are flagged
 * before anyone has to call for help.
 */
import { NEED_LABELS } from "./needs";

export interface SilenceHousehold {
  id: string;
  label: string;
  lang: "en" | "fr";
  needs: string[];
}

export interface SilentHome {
  household: string;
  label: string;
  lang: "en" | "fr";
  needs: string[];
  minutesSilent: number;
}

export function computeSilent(args: {
  households: SilenceHousehold[];
  lastHeardAt: Record<string, number | null | undefined>;
  emergencySince: number | null;
  now: number;
  thresholdMinutes: number;
}): SilentHome[] {
  const { households, lastHeardAt, emergencySince, now, thresholdMinutes } = args;
  if (emergencySince == null || thresholdMinutes <= 0) return [];

  const out: (SilentHome & { risk: number })[] = [];
  for (const h of households) {
    if (!h.needs.length) continue;
    const last = lastHeardAt[h.id];
    if (last != null && last >= emergencySince) continue;
    const minutesSilent = Math.max(0, Math.floor((now - emergencySince) / 60_000));
    if (minutesSilent < thresholdMinutes) continue;
    const weight = h.needs.reduce((s, id) => s + (NEED_LABELS[id]?.weight ?? 5), 0);
    out.push({
      household: h.id,
      label: h.label,
      lang: h.lang,
      needs: h.needs.map((id) => NEED_LABELS[id]?.en ?? id),
      minutesSilent,
      risk: weight * minutesSilent,
    });
  }
  return out.sort((a, b) => b.risk - a.risk || a.label.localeCompare(b.label)).map(({ risk: _r, ...rest }) => rest);
}
