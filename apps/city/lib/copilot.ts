/**
 * Pure helpers for the Hey Porchlight coordinator voice copilot.
 * No React, no browser APIs: resolve spoken addresses and build spoken overviews.
 */

export interface CopilotHousehold {
  id: string;
  label: string;
}

const ONES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

/** Lowercase, strip punctuation, turn spelled numbers from one to fifty into digits. */
export function normalizeSpoken(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Compound forms first: "twenty one" → 21, then "twenty" alone → 20.
  for (const [tensWord, tensVal] of Object.entries(TENS)) {
    if (tensVal === 50) {
      t = t.replace(new RegExp(`\\b${tensWord}\\b`, "g"), String(tensVal));
      continue;
    }
    for (const [oneWord, oneVal] of Object.entries(ONES)) {
      if (oneVal > 9) continue;
      t = t.replace(new RegExp(`\\b${tensWord}\\s+${oneWord}\\b`, "g"), String(tensVal + oneVal));
    }
    t = t.replace(new RegExp(`\\b${tensWord}\\b`, "g"), String(tensVal));
  }
  for (const [word, n] of Object.entries(ONES)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, "g"), String(n));
  }
  return t.replace(/\s+/g, " ").trim();
}

function splitAddress(normalized: string): { number: string | null; street: string } {
  const m = normalized.match(/^(\d+)\s+(.+)$/);
  if (m) return { number: m[1]!, street: m[2]! };
  return { number: null, street: normalized };
}

/**
 * Match a spoken address like "Maple", "twelve Maple Crescent", "12 maple" or "Pine Walk"
 * to a household. Prefers a street-name match. Returns null when nothing fits.
 */
export function resolveHousehold(
  query: string,
  households: CopilotHousehold[],
): { id: string; label: string } | null {
  const q = normalizeSpoken(query);
  if (!q) return null;
  const qParts = splitAddress(q);

  type Scored = { id: string; label: string; score: number };
  const scored: Scored[] = [];

  for (const h of households) {
    const full = normalizeSpoken(h.label);
    const parts = splitAddress(full);
    let score = 0;

    // Prefer street name: query is the street, or query street equals / is contained in label street.
    if (parts.street === q || parts.street === qParts.street) score += 100;
    else if (qParts.street && parts.street.includes(qParts.street)) score += 80;
    else if (parts.street.includes(q)) score += 70;
    else if (q.includes(parts.street) && parts.street.length >= 4) score += 60;

    if (qParts.number && parts.number === qParts.number) score += 40;
    else if (parts.number && q.startsWith(parts.number + " ")) score += 40;

    if (full === q) score += 50;
    else if (full.includes(q) && q.length >= 3) score += 20;

    if (score > 0) scored.push({ id: h.id, label: h.label, score });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const best = scored[0]!;
  // Ambiguous: two homes share the same top score without a house number to break the tie.
  if (scored[1] && scored[1].score === best.score && !qParts.number) return null;
  return { id: best.id, label: best.label };
}

export interface OverviewQueueItem {
  label: string;
  needs: string[];
  /** True when Porch Circles has escalated to the city with no neighbour reply. */
  noNeighbour?: boolean;
  /** Power-dependent home reported lights off during the emergency. */
  powerOut?: boolean;
}

export interface OverviewSilentItem {
  label: string;
  minutesSilent: number;
  powerOut?: boolean;
}

export interface OverviewInput {
  counts: { help: number; acknowledged: number; ok: number; unknown: number };
  queue: OverviewQueueItem[];
  silent: OverviewSilentItem[];
  outage: boolean;
  emergencySince: number | null;
  nodesReporting: number;
  nodesTotal: number;
  latestNotice?: { en: string; reachedNodes: number; totalNodes: number } | null;
  /** Power-dependent homes currently reporting lights out. */
  powerOutHomes?: { label: string; need: string }[];
}

/** A short spoken summary for the coordinator, kept under 80 words. */
export function buildOverview(input: OverviewInput): string {
  const parts: string[] = [];
  const open = input.queue;
  if (!open.length) {
    parts.push("No open calls right now.");
  } else {
    parts.push(
      open.length === 1 ? "One home needs help." : `${open.length} homes need help.`,
    );
    const top = open.slice(0, 3);
    for (let i = 0; i < top.length; i += 1) {
      const item = top[i]!;
      const need = item.needs[0] ?? "no recorded need";
      if (i === 0) parts.push(`First is ${item.label}, ${need}.`);
      else parts.push(`Then ${item.label}, ${need}.`);
    }
    if (open.length > 3) parts.push(`And ${open.length - 3} more in the queue.`);
    const lonely = open.filter((q) => q.noNeighbour).map((q) => q.label);
    if (lonely.length === 1) {
      parts.push(`No neighbour has answered at ${lonely[0]}.`);
    } else if (lonely.length > 1) {
      parts.push(`No neighbour has answered at ${lonely.length} homes, including ${lonely[0]}.`);
    }
  }

  if (input.silent.length) {
    const s = input.silent[0]!;
    if (input.silent.length === 1) {
      parts.push(`One silent home: ${s.label}, quiet for ${s.minutesSilent} minutes.`);
    } else {
      parts.push(
        `${input.silent.length} silent homes. Highest risk is ${s.label}, quiet for ${s.minutesSilent} minutes.`,
      );
    }
  }

  if (input.powerOutHomes?.length) {
    const p = input.powerOutHomes[0]!;
    if (input.powerOutHomes.length === 1) {
      parts.push(`Power out at ${p.label}, a home with ${p.need}.`);
    } else {
      parts.push(
        `Power out at ${input.powerOutHomes.length} power-dependent homes, including ${p.label}.`,
      );
    }
  }

  if (input.latestNotice) {
    const n = input.latestNotice;
    parts.push(
      `Latest notice: ${n.en} Reached ${n.reachedNodes} of ${n.totalNodes} nodes.`,
    );
  }

  if (input.outage) parts.push("City link is down; nodes are holding calls.");
  else parts.push("City link is up.");

  if (input.emergencySince != null) parts.push("Emergency is active.");

  parts.push(`${input.nodesReporting} of ${input.nodesTotal} nodes reporting.`);

  const text = parts.join(" ");
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 80) return text;
  return words.slice(0, 80).join(" ");
}
