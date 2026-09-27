/**
 * Silence is a signal: during an emergency, vulnerable homes that go quiet are flagged
 * before anyone has to call for help.
 *
 * Motion, presence and lights_on count as signs of life and clear the silent list.
 * lights_off does not: a dark porch alone is not "we heard from them".
 */
import type { AliveSignal } from "@porchlight/protocol";
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
  /** True when a power-dependent home reported lights off during the emergency. */
  powerOut?: boolean;
}

/** Alive signals that count as having heard from a home. */
export function isSignOfLife(signal: AliveSignal | string | undefined | null): boolean {
  return signal === "motion" || signal === "presence" || signal === "lights_on";
}

export interface HeardEvent {
  household: string;
  kind: string;
  signal?: AliveSignal | string | null;
  at: number;
}

/**
 * Latest wall time we "heard from" each home for silence.
 * Help, ok, ack, note, reply and sign-of-life alive events count.
 * Alive with lights_off does not. Notices (city-hall) are ignored via household filter upstream.
 */
export function lastHeardAtForSilence(events: readonly HeardEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.kind === "alive") {
      if (!isSignOfLife(e.signal)) continue;
    } else if (e.kind === "notice") {
      continue;
    } else if (e.kind !== "help" && e.kind !== "ok" && e.kind !== "ack" && e.kind !== "note" && e.kind !== "reply") {
      continue;
    }
    const prev = out[e.household];
    if (prev == null || e.at > prev) out[e.household] = e.at;
  }
  return out;
}

export function computeSilent(args: {
  households: SilenceHousehold[];
  lastHeardAt: Record<string, number | null | undefined>;
  emergencySince: number | null;
  now: number;
  thresholdMinutes: number;
  /** Household ids with power out (lights off + power-dependent need). Their risk is doubled. */
  powerOut?: ReadonlySet<string> | readonly string[];
}): SilentHome[] {
  const { households, lastHeardAt, emergencySince, now, thresholdMinutes } = args;
  if (emergencySince == null || thresholdMinutes <= 0) return [];
  const powerOut =
    args.powerOut instanceof Set
      ? args.powerOut
      : new Set(args.powerOut ?? []);

  const out: (SilentHome & { risk: number })[] = [];
  for (const h of households) {
    if (!h.needs.length) continue;
    const last = lastHeardAt[h.id];
    if (last != null && last >= emergencySince) continue;
    const minutesSilent = Math.max(0, Math.floor((now - emergencySince) / 60_000));
    if (minutesSilent < thresholdMinutes) continue;
    const weight = h.needs.reduce((s, id) => s + (NEED_LABELS[id]?.weight ?? 5), 0);
    const outage = powerOut.has(h.id);
    const risk = weight * minutesSilent * (outage ? 2 : 1);
    out.push({
      household: h.id,
      label: h.label,
      lang: h.lang,
      needs: h.needs.map((id) => NEED_LABELS[id]?.en ?? id),
      minutesSilent,
      powerOut: outage || undefined,
      risk,
    });
  }
  return out
    .sort((a, b) => b.risk - a.risk || a.label.localeCompare(b.label))
    .map(({ risk: _r, ...rest }) => rest);
}
