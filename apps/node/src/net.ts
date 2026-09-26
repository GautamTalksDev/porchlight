import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExchangeRequest, PullRequest, PushRequest, SyncTransport } from "@porchlight/protocol";

export const MAX_BODY_BYTES = 1_000_000;

/** Optional LAN-level authentication: every sync request carries an HMAC of its body under NETWORK_KEY. */
export function macOf(networkKey: string, body: string): string {
  return createHmac("sha256", networkKey).update(body).digest("hex");
}

export function macMatches(networkKey: string, body: string, header: string | undefined): boolean {
  if (!networkKey) return true;
  if (!header || !/^[0-9a-f]{64}$/.test(header)) return false;
  return timingSafeEqual(Buffer.from(macOf(networkKey, body), "hex"), Buffer.from(header, "hex"));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, "body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "x-frame-options": "DENY",
};

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** Token bucket per key. Keeps a misbehaving peer or script from flooding the node. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return true;
  }
}

export class ChaosError extends Error {}

/** Gossip over HTTP. `chaos()` returns the current drop probability so the demo can dial in packet loss live. */
export class HttpPeer implements SyncTransport {
  constructor(
    readonly url: string,
    private readonly networkKey: string,
    private readonly chaos: () => number,
    private readonly timeoutMs = 3000,
  ) {}

  private async post<T>(path: string, payload: unknown): Promise<T> {
    if (Math.random() < this.chaos()) throw new ChaosError("dropped by chaos");
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.networkKey) headers["x-porchlight-mac"] = macOf(this.networkKey, body);
    const res = await fetch(`${this.url}${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  exchange(req: ExchangeRequest) {
    return this.post<import("@porchlight/protocol").ExchangeResponse>("/sync/exchange", req);
  }
  push(req: PushRequest) {
    return this.post<{ added: number; rejected: number }>("/sync/push", req);
  }
  pull(req: PullRequest) {
    return this.post<unknown[]>("/sync/pull", req);
  }
}
