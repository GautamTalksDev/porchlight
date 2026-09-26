/**
 * Shared Gemini model list and free-tier quota cooldown for triage and notice translation.
 */

export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

export const GEMINI_QUOTA_COOLDOWN_MS = 10 * 60_000;
export const TRIAGE_GEMINI_MIN_INTERVAL_MS = 20_000;

type CooldownMap = Map<string, number>;

const g = globalThis as unknown as { __plGeminiCooldown?: CooldownMap };

function cooldownMap(): CooldownMap {
  return (g.__plGeminiCooldown ??= new Map());
}

/** Ordered models to try. GEMINI_MODELS wins; else GEMINI_MODEL then GEMINI_FALLBACK_MODEL; else the default list. */
export function resolveGeminiModels(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string[] {
  const fromList = (env.GEMINI_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromList.length) return [...new Set(fromList)];

  const primary = (env.GEMINI_MODEL ?? "").trim();
  const fallback = (env.GEMINI_FALLBACK_MODEL ?? "").trim();
  const legacy = [primary, fallback].filter(Boolean);
  if (legacy.length) return [...new Set(legacy)];

  return [...DEFAULT_GEMINI_MODELS];
}

/** True when the error looks like a free-tier or rate quota rejection. */
export function isGeminiQuotaError(err: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur; depth += 1) {
    if (typeof cur === "string") {
      parts.push(cur);
      break;
    }
    const o = cur as {
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (o.status === 429 || o.statusCode === 429 || o.code === 429 || o.code === "RESOURCE_EXHAUSTED") {
      return true;
    }
    if (typeof o.message === "string") parts.push(o.message);
    if (cur instanceof Error) parts.push(cur.message);
    cur = o.cause;
  }
  return /\b429\b|RESOURCE_EXHAUSTED|quota exceeded|rate[- ]?limit/i.test(parts.join(" "));
}

/** Mark a model as exhausted for 10 minutes and log one line. */
export function markGeminiQuotaExhausted(model: string, now = Date.now()): void {
  cooldownMap().set(model, now + GEMINI_QUOTA_COOLDOWN_MS);
  console.error(`[gemini] ${model} quota exhausted, cooling down 10 min`);
}

export function isGeminiModelCooling(model: string, now = Date.now()): boolean {
  const until = cooldownMap().get(model);
  if (until == null) return false;
  if (now >= until) {
    cooldownMap().delete(model);
    return false;
  }
  return true;
}

/** Models from the configured list that are still cooling, newest remaining first. */
export function geminiModelsCooling(
  now = Date.now(),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { model: string; remainingMs: number }[] {
  const out: { model: string; remainingMs: number }[] = [];
  for (const model of resolveGeminiModels(env)) {
    const until = cooldownMap().get(model);
    if (until == null) continue;
    const remainingMs = until - now;
    if (remainingMs <= 0) {
      cooldownMap().delete(model);
      continue;
    }
    out.push({ model, remainingMs });
  }
  return out.sort((a, b) => b.remainingMs - a.remainingMs);
}

/** Configured models that are not in cooldown. */
export function availableGeminiModels(
  now = Date.now(),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  return resolveGeminiModels(env).filter((m) => !isGeminiModelCooling(m, now));
}

/** Preflight detail for models currently cooling down. */
export function geminiQuotaPreflightDetail(
  now = Date.now(),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { ok: boolean; detail: string } {
  const cooling = geminiModelsCooling(now, env);
  if (!cooling.length) return { ok: true, detail: "no models cooling down" };
  const parts = cooling.map((c) => {
    const mins = Math.max(1, Math.ceil(c.remainingMs / 60_000));
    return `${c.model} (${mins} min left)`;
  });
  return { ok: false, detail: parts.join(", ") };
}

/**
 * Reuse a cached triage ranking when the open-case fingerprint is unchanged,
 * or when a Gemini call was made less than minIntervalMs ago.
 */
export function shouldReuseTriageCache(input: {
  key: string;
  cachedKey?: string;
  lastCallAt?: number;
  now: number;
  minIntervalMs?: number;
}): boolean {
  if (input.cachedKey == null || input.lastCallAt == null) return false;
  if (input.cachedKey === input.key) return true;
  return input.now - input.lastCallAt < (input.minIntervalMs ?? TRIAGE_GEMINI_MIN_INTERVAL_MS);
}

/** Test helper: clear in-memory cooldowns. */
export function clearGeminiCooldownForTests(): void {
  cooldownMap().clear();
}
