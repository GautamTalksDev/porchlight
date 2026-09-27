import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { compareHlc } from "./hlc";
import { verifyEvent, type SignedEvent, type VerifyOptions } from "./event";

export const BUCKETS = "0123456789abcdef".split("");
export type BucketDigest = Record<string, string>;

export interface StoreAdapter {
  load(): unknown[];
  append(event: SignedEvent): void;
}

export class MemoryAdapter implements StoreAdapter {
  load(): unknown[] {
    return [];
  }
  append(): void {}
}

/**
 * Append-only JSON Lines log. Each line is one signed event.
 * On load, a torn final line (power cut mid-write) is skipped instead of crashing the node.
 */
export class JsonlFileAdapter implements StoreAdapter {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  load(): unknown[] {
    if (!existsSync(this.path)) return [];
    const out: unknown[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // torn write; skip
      }
    }
    return out;
  }
  append(event: SignedEvent): void {
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }
}

export type AddResult =
  | { added: true }
  | { added: false; reason: string; pending?: boolean };

/**
 * A grow-only set of signed events (a G-Set CRDT). Merging is set union, so every node that has
 * seen the same events holds exactly the same state, in any order, with any duplicates.
 */
export class EventStore {
  private readonly events = new Map<string, SignedEvent>();
  private readonly bucketIds = new Map<string, Set<string>>(BUCKETS.map((b) => [b, new Set()]));
  private readonly bucketHash = new Map<string, string>();
  private readonly dirty = new Set<string>(BUCKETS);
  private readonly listeners = new Set<(e: SignedEvent) => void>();
  /** Signed notices held until cityOrigin is pinned, then re-verified. */
  private readonly pendingNotices = new Map<string, SignedEvent>();
  rejected = 0;

  constructor(
    private readonly adapter: StoreAdapter = new MemoryAdapter(),
    private readonly verifyOpts: () => VerifyOptions = () => ({}),
  ) {
    for (const raw of adapter.load()) {
      // Re-verify on load: a tampered file on disk is just another untrusted peer.
      const r = verifyEvent(raw, { ...this.verifyOpts(), maxFutureSkewMs: Number.MAX_SAFE_INTEGER });
      if (r.ok === true) this.insert(r.event, false);
      else if (r.ok === "pending_city") this.pendingNotices.set(r.event.id, r.event);
    }
  }

  get size(): number {
    return this.events.size;
  }

  /** Notices waiting for a pinned city id. */
  get pendingNoticeCount(): number {
    return this.pendingNotices.size;
  }

  has(id: string): boolean {
    return this.events.has(id);
  }

  get(id: string): SignedEvent | undefined {
    return this.events.get(id);
  }

  /** Events in causal (HLC) order. */
  all(): SignedEvent[] {
    return [...this.events.values()].sort((a, b) => compareHlc(a.hlc, b.hlc));
  }

  onAdd(fn: (e: SignedEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Add an untrusted event. Verified before insert. Idempotent. */
  add(input: unknown): AddResult {
    const id = (input as { id?: unknown })?.id;
    if (typeof id === "string" && this.events.has(id)) return { added: false, reason: "duplicate" };
    const r = verifyEvent(input, this.verifyOpts());
    if (r.ok === "pending_city") {
      this.pendingNotices.set(r.event.id, r.event);
      return { added: false, reason: "city not pinned yet", pending: true };
    }
    if (r.ok !== true) {
      this.rejected++;
      return { added: false, reason: r.reason };
    }
    this.pendingNotices.delete(r.event.id);
    this.insert(r.event, true);
    return { added: true };
  }

  /**
   * Re-check notices held while the City id was unknown. Call after pinning cityOrigin
   * (verifyOpts must already return the new id).
   */
  retryPendingNotices(): { added: number; rejected: number } {
    let added = 0;
    let rejected = 0;
    const held = [...this.pendingNotices.values()];
    this.pendingNotices.clear();
    for (const ev of held) {
      const r = this.add(ev);
      if (r.added) added += 1;
      else if (r.pending) {
        /* still unpinned */
      } else if (r.reason !== "duplicate") rejected += 1;
    }
    return { added, rejected };
  }

  private insert(ev: SignedEvent, persist: boolean): void {
    if (this.events.has(ev.id)) return;
    this.events.set(ev.id, ev);
    const b = ev.id[0]!;
    this.bucketIds.get(b)!.add(ev.id);
    this.dirty.add(b);
    if (persist) this.adapter.append(ev);
    for (const fn of this.listeners) fn(ev);
  }

  /** 16 bucket hashes. Two stores with equal digests hold identical event sets. */
  digest(): BucketDigest {
    const out: BucketDigest = {};
    for (const b of BUCKETS) {
      if (this.dirty.has(b)) {
        const ids = [...this.bucketIds.get(b)!].sort();
        this.bucketHash.set(b, ids.length ? createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16) : "-");
        this.dirty.delete(b);
      }
      out[b] = this.bucketHash.get(b)!;
    }
    return out;
  }

  idsIn(buckets: readonly string[]): string[] {
    const out: string[] = [];
    for (const b of buckets) {
      const set = this.bucketIds.get(b);
      if (set) out.push(...set);
    }
    return out;
  }
}

export function diffBuckets(a: BucketDigest, b: BucketDigest): string[] {
  return BUCKETS.filter((k) => a[k] !== b[k]);
}
