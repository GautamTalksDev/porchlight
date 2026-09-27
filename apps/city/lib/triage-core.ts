/**
 * Triage logic that does not depend on any AI service. Used as the fallback when Gemini is
 * unavailable, and as the safety net that guarantees every open call appears in the ranking.
 * Pure functions, unit tested in test/triage.test.ts.
 * Browser-safe: no Node built-ins and no protocol package imports.
 */
import { z } from "zod";
import { powerOutTriageBoost } from "./power";

/** Same tiers as the protocol package; defined here so this file stays client-safe. */
export type EscalationTier = "buddies" | "street" | "city";

export interface TriageCase {
  ref: string;
  status: "open" | "acknowledged";
  waitMinutes: number;
  witnesses: number;
  needs: { id: string; weight: number }[];
  lang: "en" | "fr";
  note?: string;
  fall?: boolean;
  /** Porch Circles escalation tier for open calls. */
  tier?: EscalationTier | null;
  /** Short summary of neighbour replies for Gemini (already sanitised). */
  neighbourReplies?: string;
  /** Power-dependent home reported lights off during the emergency. */
  powerOut?: boolean;
}

export const Action = z.enum(["dispatch_neighbour", "voice_check_in", "monitor"]);
export type Action = z.infer<typeof Action>;

export const RankedItem = z.object({
  ref: z.string().max(8),
  priority: z.number().int().min(1).max(5),
  reason: z.string().max(240),
  action: Action,
  script_en: z.string().max(400),
  script_fr: z.string().max(400),
});
export type RankedItem = z.infer<typeof RankedItem>;
export const TriageOutput = z.object({ ranking: z.array(RankedItem).max(200) });

export function ruleScore(c: TriageCase): number {
  const needs = c.needs.reduce((s, n) => s + n.weight, 0);
  const wait = Math.min(60, c.waitMinutes) * 1.2;
  const corroboration = c.witnesses > 1 ? 5 : 0;
  const unanswered = c.status === "open" ? 20 : 0;
  const fall = c.fall ? 25 : 0;
  const tierBoost = c.tier === "city" ? 15 : c.tier === "street" ? 5 : 0;
  const powerBoost = powerOutTriageBoost(
    c.needs.map((n) => n.id),
    c.powerOut === true,
  ).boost;
  return needs + wait + corroboration + unanswered + fall + tierBoost + powerBoost;
}

export function ruleRanking(cases: TriageCase[]): RankedItem[] {
  return [...cases]
    .sort((a, b) => ruleScore(b) - ruleScore(a))
    .map((c) => {
      const s = ruleScore(c);
      const powerDependent = c.needs.some((n) => n.weight >= 40);
      const powerBoost = powerOutTriageBoost(
        c.needs.map((n) => n.id),
        c.powerOut === true,
      );
      const priority = s >= 70 ? 1 : s >= 50 ? 2 : s >= 35 ? 3 : s >= 20 ? 4 : 5;
      const parts: string[] = [];
      if (c.tier === "city") parts.push(`no neighbour has answered in ${c.waitMinutes} min`);
      if (c.fall) parts.push("possible fall, no button pressed");
      if (powerBoost.reason) parts.push(powerBoost.reason);
      else if (powerDependent) parts.push("depends on power for medical equipment");
      if (c.status === "open" && c.tier !== "city") parts.push("no neighbour has responded");
      if (c.tier !== "city") parts.push(`waiting ${c.waitMinutes} min`);
      return {
        ref: c.ref,
        priority,
        reason: parts.join(", "),
        action: powerDependent || c.powerOut || c.status === "open" ? "dispatch_neighbour" : "voice_check_in",
        script_en: "Hello, this is Porchlight calling for the city. We received your call for help. Are you safe right now?",
        script_fr: "Bonjour, ici Porchlight pour la Ville. Nous avons reçu votre appel à l'aide. Êtes-vous en sécurité en ce moment?",
      } satisfies RankedItem;
    });
}

/** Keep only refs we sent, drop duplicates, and append anything the model left out using the rules. */
export function reconcile(cases: TriageCase[], model: RankedItem[]): RankedItem[] {
  const known = new Set(cases.map((c) => c.ref));
  const seen = new Set<string>();
  const out: RankedItem[] = [];
  for (const r of model) {
    if (!known.has(r.ref) || seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push(r);
  }
  for (const r of ruleRanking(cases.filter((c) => !seen.has(c.ref)))) out.push(r);
  return out;
}

/** Resident notes are untrusted. Strip control characters and cap the length before any model sees them. */
export function sanitizeNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  return note.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
}

export interface OpenIncidentLike {
  key: string;
  household: string;
  status: string;
  openedAtMs: number;
  witnesses: string[];
}

/** One entry per home: prefer an unanswered call, then the one waiting longest. Witnesses are merged. */
export function collapseByHousehold<T extends OpenIncidentLike>(list: T[]): T[] {
  const best = new Map<string, T>();
  const heard = new Map<string, Set<string>>();
  const rank = (i: T) => (i.status === "open" ? 0 : 1);
  for (const inc of list) {
    const w = heard.get(inc.household) ?? new Set<string>();
    for (const x of inc.witnesses) w.add(x);
    heard.set(inc.household, w);
    const cur = best.get(inc.household);
    if (!cur || rank(inc) < rank(cur) || (rank(inc) === rank(cur) && inc.openedAtMs < cur.openedAtMs)) best.set(inc.household, inc);
  }
  return [...best.values()].map((i) => ({ ...i, witnesses: [...(heard.get(i.household) ?? [])] }));
}

export function describeGeminiFailure(message: string): string {
  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(message)) return "Gemini is busy right now, so calls are ordered by the built-in rules.";
  if (/took longer|timed? ?out|deadline/i.test(message)) return "Gemini did not answer in time, so calls are ordered by the built-in rules.";
  if (/\b40[13]\b|api key|permission/i.test(message)) return "Gemini rejected the API key, so calls are ordered by the built-in rules.";
  return "Gemini is unavailable, so calls are ordered by the built-in rules.";
}
