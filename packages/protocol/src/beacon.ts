import { siphash24, tagsEqual } from "./siphash";

/**
 * Beacon frame, 18 bytes, sent as a BLE notification (fits the default 20-byte ATT payload):
 *   [0]     version (1)
 *   [1]     kind: 1 = help, 2 = ok, 3 = test (beacon to node), 16 = ack (node to beacon)
 *   [2..5]  session id, uint32 LE, random per boot
 *   [6..9]  counter, uint32 LE, increments per press
 *   [10..17] SipHash-2-4 tag over (beaconId || 0x00 || bytes 0..9) with the beacon's 16-byte key
 * The key never leaves the beacon and the node agent. The browser only relays opaque bytes.
 */
export const FRAME_LEN = 18;
export const FRAME_VERSION = 1;
export type BeaconKind = "help" | "ok" | "test" | "ack";
const KINDS: Record<number, BeaconKind> = { 1: "help", 2: "ok", 3: "test", 16: "ack" };

export interface BeaconFrame {
  beaconId: string;
  kind: BeaconKind;
  session: number;
  counter: number;
  incident: string;
}

export type FrameResult = { ok: true; frame: BeaconFrame } | { ok: false; reason: string };

export function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function macInput(beaconId: string, head: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(beaconId);
  const buf = new Uint8Array(id.length + 1 + head.length);
  buf.set(id, 0);
  buf[id.length] = 0;
  buf.set(head, id.length + 1);
  return buf;
}

export function incidentKey(beaconId: string, session: number, counter: number): string {
  return `${beaconId}:${session.toString(16).padStart(8, "0")}:${counter}`;
}

export function encodeFrame(beaconId: string, key: Uint8Array, kind: BeaconKind, session: number, counter: number): Uint8Array {
  const kindByte = Number(Object.entries(KINDS).find(([, k]) => k === kind)![0]);
  const head = new Uint8Array(10);
  const dv = new DataView(head.buffer);
  head[0] = FRAME_VERSION;
  head[1] = kindByte;
  dv.setUint32(2, session >>> 0, true);
  dv.setUint32(6, counter >>> 0, true);
  const tag = siphash24(key, macInput(beaconId, head));
  const frame = new Uint8Array(FRAME_LEN);
  frame.set(head, 0);
  frame.set(tag, 10);
  return frame;
}

export function decodeFrame(beaconId: string, key: Uint8Array, frame: Uint8Array): FrameResult {
  if (frame.length !== FRAME_LEN) return { ok: false, reason: `frame must be ${FRAME_LEN} bytes` };
  if (frame[0] !== FRAME_VERSION) return { ok: false, reason: "unsupported frame version" };
  const kind = KINDS[frame[1]!];
  if (!kind) return { ok: false, reason: "unknown kind" };
  const head = frame.slice(0, 10);
  const expected = siphash24(key, macInput(beaconId, head));
  if (!tagsEqual(expected, frame.slice(10))) return { ok: false, reason: "bad MAC" };
  const dv = new DataView(head.buffer, head.byteOffset);
  const session = dv.getUint32(2, true);
  const counter = dv.getUint32(6, true);
  return { ok: true, frame: { beaconId, kind, session, counter, incident: incidentKey(beaconId, session, counter) } };
}

/**
 * Replay and flood guard for one node.
 * - exact duplicate (same session + counter): ignored, not an error (BLE often double-delivers)
 * - counter going backwards within a session: rejected as replay
 * - more than one accepted frame per beacon per `minIntervalMs`: rejected as flood
 */
export class BeaconGuard {
  private readonly maxCounter = new Map<string, number>();
  private readonly lastAccepted = new Map<string, number>();

  constructor(
    private readonly minIntervalMs = 750,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seed from events already in the store so a restarted node keeps its replay window. */
  seen(beaconId: string, session: number, counter: number): void {
    const k = `${beaconId}:${session}`;
    this.maxCounter.set(k, Math.max(this.maxCounter.get(k) ?? -1, counter));
  }

  check(f: BeaconFrame): "accept" | "duplicate" | "replay" | "flood" {
    const k = `${f.beaconId}:${f.session}`;
    const max = this.maxCounter.get(k) ?? -1;
    if (f.counter === max) return "duplicate";
    if (f.counter < max) return "replay";
    const t = this.now();
    const last = this.lastAccepted.get(f.beaconId) ?? -Infinity;
    if (t - last < this.minIntervalMs) return "flood";
    this.maxCounter.set(k, f.counter);
    this.lastAccepted.set(f.beaconId, t);
    return "accept";
  }
}
