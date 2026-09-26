import "server-only";

const g = globalThis as unknown as { __plBuckets?: Map<string, { tokens: number; at: number }> };

/** Token bucket per key. Returns false when the caller should slow down. */
export function allow(key: string, capacity: number, perSecond: number): boolean {
  g.__plBuckets ??= new Map();
  const now = Date.now();
  const b = g.__plBuckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  g.__plBuckets.set(key, b);
  if (g.__plBuckets.size > 5000) g.__plBuckets.clear();
  return ok;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new RangeError("body too large");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new RangeError("body too large");
  return JSON.parse(text);
}
