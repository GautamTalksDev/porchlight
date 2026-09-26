import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalize } from "./canonical";
import { decodeHlc, encodeHlc, type HybridClock } from "./hlc";
import { nodeIdFromPub, signBytes, verifyBytes, type NodeIdentity } from "./identity";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_NOTE_LENGTH = 280;
/** Neighbour reply text on the mesh: short enough to read on a phone in the dark. */
export const MAX_REPLY_NOTE_LENGTH = 140;
/** Reject events stamped further in the future than this. Offline clocks drift, so be generous but bounded. */
export const DEFAULT_MAX_FUTURE_SKEW_MS = 15 * 60 * 1000;

const hex16 = z.string().regex(/^[0-9a-f]{16}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const b64urlPub = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const b64urlSig = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/);
// Printable text only: no control characters, so notes can't smuggle terminal escapes or break log lines.
const safeText = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "control characters are not allowed");

export const EventKind = z.enum(["help", "ok", "ack", "note", "reply"]);
export type EventKind = z.infer<typeof EventKind>;

export const ReplyCode = z.enum(["omw", "cant", "generator", "blocked"]);
export type ReplyCode = z.infer<typeof ReplyCode>;

export const REPLY_LABELS: Record<ReplyCode, string> = {
  omw: "On my way",
  cant: "Can't go",
  generator: "I have a generator",
  blocked: "Road blocked",
};

export const EventSource = z.strictObject({
  type: z.enum(["beacon", "console", "sim"]),
  beacon: slug.optional(),
  rssi: z.number().int().min(-127).max(20).optional(),
});

export const EventBody = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  kind: EventKind,
  household: slug,
  origin: hex16,
  pub: b64urlPub,
  hlc: z.string().regex(/^\d{15}\.\d{6}\.[0-9a-f]{16}$/),
  incident: z.string().regex(/^[a-z0-9:-]{3,96}$/).optional(),
  ref: hex64.optional(),
  /** Household that authored a neighbour reply (Porch Circles). */
  actor: slug.optional(),
  reply: ReplyCode.optional(),
  source: EventSource,
  lang: z.enum(["en", "fr"]).optional(),
  note: safeText.optional(),
});
export type EventBody = z.infer<typeof EventBody>;

export const SignedEvent = EventBody.extend({ id: hex64, sig: b64urlSig });
export type SignedEvent = z.infer<typeof SignedEvent>;

export interface NewEventFields {
  kind: EventKind;
  household: string;
  incident?: string;
  ref?: string;
  actor?: string;
  reply?: ReplyCode;
  source: z.infer<typeof EventSource>;
  lang?: "en" | "fr";
  note?: string;
}

export function eventIdOf(body: EventBody): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function assertReplyFields(fields: NewEventFields): void {
  if (fields.kind !== "reply") return;
  if (!fields.reply) throw new Error("reply events need a reply code");
  if (!fields.ref) throw new Error("reply events need a ref");
  if (!fields.actor) throw new Error("reply events need an actor household");
  if (fields.note !== undefined && fields.note.length > MAX_REPLY_NOTE_LENGTH) {
    throw new Error(`reply text must be at most ${MAX_REPLY_NOTE_LENGTH} characters`);
  }
}

export function createEvent(identity: NodeIdentity, clock: HybridClock, fields: NewEventFields): SignedEvent {
  assertReplyFields(fields);
  const body: EventBody = EventBody.parse({
    v: PROTOCOL_VERSION,
    origin: identity.id,
    pub: identity.pub,
    hlc: encodeHlc(clock.tick()),
    ...fields,
  });
  if (body.kind === "help" && !body.incident) throw new Error("help events need an incident key");
  if (body.kind === "ack" && !body.ref) throw new Error("ack events need a ref");
  if (body.kind === "reply") {
    if (!body.reply || !body.ref || !body.actor) throw new Error("reply events need reply, ref and actor");
    if (body.note !== undefined && body.note.length > MAX_REPLY_NOTE_LENGTH) {
      throw new Error(`reply text must be at most ${MAX_REPLY_NOTE_LENGTH} characters`);
    }
  }
  const canonical = canonicalize(body);
  const id = createHash("sha256").update(canonical).digest("hex");
  const sig = signBytes(identity, Buffer.from(canonical));
  return { ...body, id, sig };
}

export type VerifyResult = { ok: true; event: SignedEvent } | { ok: false; reason: string };

export interface VerifyOptions {
  now?: number;
  maxFutureSkewMs?: number;
  /** If set, only events from these node ids are accepted (the neighbourhood roster). */
  allowedOrigins?: ReadonlySet<string>;
}

/** Full verification of an untrusted event. Never trust a peer: check shape, identity, hash, and signature. */
export function verifyEvent(input: unknown, opts: VerifyOptions = {}): VerifyResult {
  const parsed = SignedEvent.safeParse(input);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const ev = parsed.data;
  if (nodeIdFromPub(ev.pub) !== ev.origin) return { ok: false, reason: "origin does not match public key" };
  if (opts.allowedOrigins && !opts.allowedOrigins.has(ev.origin)) return { ok: false, reason: "origin not in roster" };
  const hlc = decodeHlc(ev.hlc);
  if (hlc.node !== ev.origin) return { ok: false, reason: "hlc node does not match origin" };
  const now = opts.now ?? Date.now();
  if (hlc.wall > now + (opts.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS)) {
    return { ok: false, reason: "timestamp too far in the future" };
  }
  if (ev.kind === "help" && !ev.incident) return { ok: false, reason: "help without incident" };
  if (ev.kind === "ack" && !ev.ref) return { ok: false, reason: "ack without ref" };
  if (ev.kind === "reply") {
    if (!ev.reply || !ev.ref || !ev.actor) return { ok: false, reason: "reply without reply, ref or actor" };
    if (ev.note !== undefined && ev.note.length > MAX_REPLY_NOTE_LENGTH) {
      return { ok: false, reason: "reply text too long" };
    }
  }
  const { id, sig, ...body } = ev;
  const canonical = canonicalize(body);
  const expectedId = createHash("sha256").update(canonical).digest("hex");
  if (expectedId !== id) return { ok: false, reason: "id does not match content" };
  if (!verifyBytes(ev.pub, Buffer.from(canonical), sig)) return { ok: false, reason: "bad signature" };
  return { ok: true, event: ev };
}
