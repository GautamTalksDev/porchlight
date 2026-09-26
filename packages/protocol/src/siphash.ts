/**
 * SipHash-2-4 (Aumasson & Bernstein, 2012), 64-bit output.
 * A keyed MAC small enough to run on the beacon's microcontroller.
 * The same algorithm is implemented in firmware/porchlight-beacon/siphash.h.
 */
const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, b: bigint): bigint => ((x << b) | (x >> (64n - b))) & MASK;

function readU64LE(buf: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(buf[off + i]!);
  return v;
}

export function siphash24(key: Uint8Array, msg: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new RangeError("siphash key must be 16 bytes");
  const k0 = readU64LE(key, 0);
  const k1 = readU64LE(key, 8);
  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;

  const round = () => {
    v0 = (v0 + v1) & MASK; v1 = rotl(v1, 13n); v1 ^= v0; v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK; v3 = rotl(v3, 16n); v3 ^= v2;
    v0 = (v0 + v3) & MASK; v3 = rotl(v3, 21n); v3 ^= v0;
    v2 = (v2 + v1) & MASK; v1 = rotl(v1, 17n); v1 ^= v2; v2 = rotl(v2, 32n);
  };

  const len = msg.length;
  const end = len - (len % 8);
  for (let i = 0; i < end; i += 8) {
    const m = readU64LE(msg, i);
    v3 ^= m; round(); round(); v0 ^= m;
  }
  let b = BigInt(len & 0xff) << 56n;
  for (let i = len % 8 - 1; i >= 0; i -= 1) b |= BigInt(msg[end + i]!) << BigInt(8 * i);
  v3 ^= b; round(); round(); v0 ^= b;
  v2 ^= 0xffn;
  round(); round(); round(); round();
  const out = (v0 ^ v1 ^ v2 ^ v3) & MASK;
  const res = new Uint8Array(8);
  for (let i = 0; i < 8; i++) res[i] = Number((out >> BigInt(8 * i)) & 0xffn);
  return res;
}

/** Constant-time comparison for MAC tags. */
export function tagsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
