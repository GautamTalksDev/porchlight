/**
 * Household light state and power-out risk during an emergency.
 * Pure functions: same inputs, same outputs, unit tested in test/power.test.ts.
 */
import type { AliveSignal } from "@porchlight/protocol";
import { aliveTrailLabel as protocolAliveTrailLabel } from "@porchlight/protocol";

export { protocolAliveTrailLabel as aliveTrailLabel };
export const POWER_DEPENDENT_NEEDS = [
  "oxygen-concentrator",
  "dialysis-at-home",
  "insulin-refrigeration",
] as const;

export type PowerDependentNeed = (typeof POWER_DEPENDENT_NEEDS)[number];

export type LightState = "on" | "off";

export function isPowerDependentNeed(id: string): boolean {
  return (POWER_DEPENDENT_NEEDS as readonly string[]).includes(id);
}

export function hasPowerDependentNeed(needs: readonly string[]): boolean {
  return needs.some(isPowerDependentNeed);
}

/** Short phrase for triage reasons: "oxygen concentrator", "home dialysis", or "insulin that needs refrigeration". */
export function powerDependentNeedPhrase(needs: readonly string[]): string | null {
  if (needs.includes("oxygen-concentrator")) return "oxygen concentrator";
  if (needs.includes("dialysis-at-home")) return "home dialysis";
  if (needs.includes("insulin-refrigeration")) return "insulin that needs refrigeration";
  return null;
}

export interface LightEvent {
  household: string;
  signal?: AliveSignal | string | null;
  at: number;
}

/** Latest lights_on / lights_off per home. Earlier motion/presence events are ignored. */
export function latestLightState(events: readonly LightEvent[]): Record<string, LightState> {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const out: Record<string, LightState> = {};
  for (const e of sorted) {
    if (e.signal === "lights_on") out[e.household] = "on";
    else if (e.signal === "lights_off") out[e.household] = "off";
  }
  return out;
}

/**
 * Homes with a power-dependent need whose latest light report is off, while an emergency is active.
 * Outside an emergency this returns an empty list: a dark porch alone is not an alert.
 */
export function computePowerOut(args: {
  households: { id: string; needs: string[] }[];
  lightState: Record<string, LightState | undefined>;
  emergencyActive: boolean;
}): string[] {
  if (!args.emergencyActive) return [];
  const out: string[] = [];
  for (const h of args.households) {
    if (!hasPowerDependentNeed(h.needs)) continue;
    if (args.lightState[h.id] !== "off") continue;
    out.push(h.id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Triage: +10 and a reason fragment when a power-dependent home has power out and an open call. */
export function powerOutTriageBoost(needs: readonly string[], powerOut: boolean): { boost: number; reason: string | null } {
  if (!powerOut) return { boost: 0, reason: null };
  const phrase = powerDependentNeedPhrase(needs);
  if (!phrase) return { boost: 0, reason: null };
  return { boost: 10, reason: `power out at a home with ${phrase}` };
}

export interface SignTimestamps {
  motion?: number;
  presence?: number;
  lights_on?: number;
  lights_off?: number;
}

/** Latest wall-clock time for each alive signal at a home. */
export function signsOfLifeFromEvents(
  events: readonly { household: string; kind: string; signal?: AliveSignal | string | null; at: number }[],
): Record<string, SignTimestamps> {
  const out: Record<string, SignTimestamps> = {};
  for (const e of events) {
    if (e.kind !== "alive" || !e.signal) continue;
    if (e.signal !== "motion" && e.signal !== "presence" && e.signal !== "lights_on" && e.signal !== "lights_off") continue;
    const slot = (out[e.household] ??= {});
    const prev = slot[e.signal];
    if (prev == null || e.at > prev) slot[e.signal] = e.at;
  }
  return out;
}

function relativeAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  return `${hr} h ago`;
}

/**
 * Detail-panel line: only signals that exist, e.g.
 * "Moved 12 s ago. Someone seen 3 min ago. Lights on."
 */
export function formatSignsOfLifeLine(signs: SignTimestamps | undefined, now: number): string | null {
  if (!signs) return null;
  const parts: string[] = [];
  if (signs.motion != null) parts.push(`Moved ${relativeAgo(signs.motion, now)}`);
  if (signs.presence != null) parts.push(`Someone seen ${relativeAgo(signs.presence, now)}`);
  const lightOn = signs.lights_on;
  const lightOff = signs.lights_off;
  if (lightOn != null || lightOff != null) {
    const onWins = lightOff == null || (lightOn != null && lightOn >= lightOff);
    parts.push(onWins ? "Lights on" : "Lights out");
  }
  if (!parts.length) return null;
  return `${parts.join(". ")}.`;
}

/** Latest single phrase for the node console street card. */
export function formatLatestSignOfLife(
  signs: SignTimestamps | undefined,
  now: number,
): string | null {
  if (!signs) return null;
  type Cand = { at: number; text: string };
  const cands: Cand[] = [];
  if (signs.motion != null) cands.push({ at: signs.motion, text: `Moved ${relativeAgo(signs.motion, now)}` });
  if (signs.presence != null) cands.push({ at: signs.presence, text: `Someone seen ${relativeAgo(signs.presence, now)}` });
  if (signs.lights_on != null) cands.push({ at: signs.lights_on, text: "Lights on" });
  if (signs.lights_off != null) cands.push({ at: signs.lights_off, text: "Lights out" });
  if (!cands.length) return null;
  cands.sort((a, b) => b.at - a.at);
  return cands[0]!.text;
}
