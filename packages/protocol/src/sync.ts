import { z } from "zod";
import type { SignedEvent } from "./event";
import { BUCKETS, diffBuckets, type BucketDigest, type EventStore } from "./store";

/**
 * Anti-entropy sync (push-pull gossip).
 * 1. Exchange 16 bucket hashes. Equal hashes mean equal contents, so most rounds end here.
 * 2. For buckets that differ, swap id lists.
 * 3. Pull what we lack, push what they lack. Every event is re-verified on arrival.
 */
export const MAX_BATCH = 250;
export const MAX_IDS = 20_000;

const hex16 = z.string().regex(/^[0-9a-f]{16}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const digestSchema = z.record(z.enum(BUCKETS as [string, ...string[]]), z.string().regex(/^([0-9a-f]{16}|-)$/));

export const ExchangeRequest = z.strictObject({ from: hex16, digest: digestSchema });
export type ExchangeRequest = z.infer<typeof ExchangeRequest>;
export const ExchangeResponse = z.strictObject({ from: hex16, digest: digestSchema, ids: z.array(hex64).max(MAX_IDS) });
export type ExchangeResponse = z.infer<typeof ExchangeResponse>;
export const PushRequest = z.strictObject({ from: hex16, events: z.array(z.unknown()).max(MAX_BATCH) });
export type PushRequest = z.infer<typeof PushRequest>;
export const PullRequest = z.strictObject({ from: hex16, ids: z.array(hex64).max(MAX_BATCH) });
export type PullRequest = z.infer<typeof PullRequest>;

export interface PushResult {
  added: number;
  rejected: number;
}

export interface SyncTransport {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
  push(req: PushRequest): Promise<PushResult>;
  pull(req: PullRequest): Promise<SignedEvent[] | unknown[]>;
}

// Server side

export function handleExchange(store: EventStore, selfId: string, req: ExchangeRequest): ExchangeResponse {
  const ours = store.digest();
  const differing = diffBuckets(ours, req.digest as BucketDigest);
  return { from: selfId, digest: ours, ids: store.idsIn(differing).slice(0, MAX_IDS) };
}

export function handlePush(store: EventStore, req: PushRequest): PushResult {
  let added = 0;
  let rejected = 0;
  for (const ev of req.events) {
    const r = store.add(ev);
    if (r.added) added++;
    else if (r.reason !== "duplicate" && !r.pending) rejected++;
  }
  return { added, rejected };
}

export function handlePull(store: EventStore, req: PullRequest): SignedEvent[] {
  const out: SignedEvent[] = [];
  for (const id of req.ids) {
    const e = store.get(id);
    if (e) out.push(e);
  }
  return out;
}

// Client side

export interface SyncStats {
  inSync: boolean;
  pulled: number;
  pushed: number;
  rejected: number;
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function syncWith(store: EventStore, selfId: string, peer: SyncTransport): Promise<SyncStats> {
  const ours = store.digest();
  const res = ExchangeResponse.parse(await peer.exchange({ from: selfId, digest: ours }));
  const differing = diffBuckets(ours, res.digest as BucketDigest);
  if (differing.length === 0) return { inSync: true, pulled: 0, pushed: 0, rejected: 0 };

  const theirIds = new Set(res.ids);
  const ourIds = store.idsIn(differing);
  const missingHere = [...theirIds].filter((id) => !store.has(id));
  const missingThere = ourIds.filter((id) => !theirIds.has(id));

  let pulled = 0;
  let rejected = 0;
  for (const batch of chunks(missingHere, MAX_BATCH)) {
    const events = await peer.pull({ from: selfId, ids: batch });
    for (const ev of events) {
      const r = store.add(ev);
      if (r.added) pulled++;
      else if (r.reason !== "duplicate" && !r.pending) rejected++;
    }
  }
  let pushed = 0;
  for (const batch of chunks(missingThere, MAX_BATCH)) {
    const events = batch.map((id) => store.get(id)).filter((e): e is SignedEvent => !!e);
    const r = await peer.push({ from: selfId, events });
    pushed += r.added;
  }
  return { inSync: false, pulled, pushed, rejected };
}
