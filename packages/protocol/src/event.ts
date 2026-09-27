import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalize } from "./canonical";
import { decodeHlc, encodeHlc, type HybridClock } from "./hlc";
import { nodeIdFromPub, signBytes, verifyBytes, type NodeIdentity } from "./identity";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_NOTE_LENGTH = 280;
/** Neighbour reply text on the mesh: short enough to read on a phone in the dark. */
export const MAX_REPLY_NOTE_LENGTH = 140;
export const MAX_NOTICE_EN_LENGTH = 280;
export const MAX_NOTICE_FR_LENGTH = 320;
/** Household slug used for city-wide notices (and later city alive pings). */
export const CITY_BROADCAST_HOUSEHOLD = "city-hall";

/** True for real homes on the street; false for the city broadcast slug. */
export function isStreetHousehold(id: string): boolean {
  return id !== CITY_BROADCAST_HOUSEHOLD;
}
/** Reject events stamped further in the future than this. Offline clocks drift, so be generous but bounded. */
export const DEFAULT_MAX_FUTURE_SKEW_MS = 15 * 60 * 1000;

const hex16 = z.string().regex(/^[0-9a-f]{16}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const b64urlPub = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const b64urlSig = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/);
// Printable text only: no control characters, so notes can't smuggle terminal escapes or break log lines.
const noControl = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);
const safeText = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .refine(noControl, "control characters are not allowed");

export const EventKind = z.enum(["help", "ok", "ack", "note", "reply", "notice", "alive"]);
export type EventKind = z.infer<typeof EventKind>;

export const ReplyCode = z.enum(["omw", "cant", "generator", "blocked"]);
export type ReplyCode = z.infer<typeof ReplyCode>;

export const REPLY_LABELS: Record<ReplyCode, string> = {
  omw: "On my way",
  cant: "Can't go",
  generator: "I have a generator",
  blocked: "Road blocked",
};

export const NoticeSeverity = z.enum(["info", "urgent"]);
export type NoticeSeverity = z.infer<typeof NoticeSeverity>;

export const NoticePayload = z.strictObject({
  en: z
    .string()
    .min(1)
    .max(MAX_NOTICE_EN_LENGTH)
    .refine(noControl, "control characters are not allowed"),
  fr: z
    .string()
    .min(1)
    .max(MAX_NOTICE_FR_LENGTH)
    .refine(noControl, "control characters are not allowed"),
  severity: NoticeSeverity,
});
export type NoticePayload = z.infer<typeof NoticePayload>;

export const EventSource = z.strictObject({
  type: z.enum(["beacon", "console", "sim"]),
  beacon: slug.optional(),
  rssi: z.number().int().min(-127).max(20).optional(),
});

export const AliveSignal = z.enum(["motion", "presence", "lights_on", "lights_off"]);
export type AliveSignal = z.infer<typeof AliveSignal>;

/** Trust-trail wording for an alive event. */
export function aliveTrailLabel(signal: AliveSignal | string | undefined | null): string {
  switch (signal) {
    case "motion":
      return "Beacon: moved";
    case "presence":
      return "Beacon: someone seen";
    case "lights_on":
      return "Beacon: lights on";
    case "lights_off":
      return "Beacon: lights out";
    default:
      return "Beacon: sign of life";
  }
}

/** Short street-card phrase for the latest alive signal (relative time for motion/presence). */
export function formatAliveSignalPhrase(
  signal: AliveSignal | string,
  atMs: number,
  nowMs: number,
): string {
  const sec = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  const ago =
    sec < 60 ? `${sec} s ago` : sec < 3600 ? `${Math.floor(sec / 60)} min ago` : `${Math.floor(sec / 3600)} h ago`;
  switch (signal) {
    case "motion":
      return `Moved ${ago}`;
    case "presence":
      return `Someone seen ${ago}`;
    case "lights_on":
      return "Lights on";
    case "lights_off":
      return "Lights out";
    default:
      return "Sign of life";
  }
}

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
  /** City broadcast notice (Porchlight city notices). */
  notice: NoticePayload.optional(),
  /** Beacon signs of life (moved, presence, lights). */
  signal: AliveSignal.optional(),
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
  notice?: NoticePayload;
  signal?: AliveSignal;
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

function assertNoticeFields(fields: NewEventFields): void {
  if (fields.kind !== "notice") return;
  if (!fields.notice) throw new Error("notice events need a notice payload");
  NoticePayload.parse(fields.notice);
}

function assertAliveFields(fields: NewEventFields): void {
  if (fields.kind !== "alive") return;
  if (!fields.signal) throw new Error("alive events need a signal");
  AliveSignal.parse(fields.signal);
}

export function createEvent(identity: NodeIdentity, clock: HybridClock, fields: NewEventFields): SignedEvent {
  assertReplyFields(fields);
  assertNoticeFields(fields);
  assertAliveFields(fields);
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
  if (body.kind === "notice") {
    if (!body.notice) throw new Error("notice events need a notice payload");
  }
  if (body.kind === "alive") {
    if (!body.signal) throw new Error("alive events need a signal");
  }
  const canonical = canonicalize(body);
  const id = createHash("sha256").update(canonical).digest("hex");
  const sig = signBytes(identity, Buffer.from(canonical));
  return { ...body, id, sig };
}

export type VerifyResult =
  | { ok: true; event: SignedEvent }
  | { ok: false; reason: string }
  /** Signature is valid, but the City origin is not pinned yet, so hold for later. */
  | { ok: "pending_city"; event: SignedEvent };

export interface VerifyOptions {
  now?: number;
  maxFutureSkewMs?: number;
  /** If set, only events from these node ids are accepted (the neighbourhood roster). */
  allowedOrigins?: ReadonlySet<string>;
  /**
   * When set to a city id, notice events must be signed by that origin.
   * When null or unset, a well-formed signed notice is returned as pending_city instead of being dropped.
   */
  cityOrigin?: string | null;
  /** Called once when a notice is rejected for not being signed by the pinned City. */
  onNoticeRejected?: () => void;
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
  if (ev.kind === "notice" && !ev.notice) return { ok: false, reason: "notice without payload" };
  const { id, sig, ...body } = ev;
  const canonical = canonicalize(body);
  const expectedId = createHash("sha256").update(canonical).digest("hex");
  if (expectedId !== id) return { ok: false, reason: "id does not match content" };
  if (!verifyBytes(ev.pub, Buffer.from(canonical), sig)) return { ok: false, reason: "bad signature" };
  if (ev.kind === "notice") {
    if (opts.cityOrigin == null) return { ok: "pending_city", event: ev };
    if (ev.origin !== opts.cityOrigin) {
      opts.onNoticeRejected?.();
      return { ok: false, reason: "notice not signed by the City" };
    }
  }
  return { ok: true, event: ev };
}
