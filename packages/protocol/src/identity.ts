import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

/** A node's long-lived Ed25519 identity. The node id is derived from the public key, so it can't be spoofed. */
export interface NodeIdentity {
  id: string;
  /** base64url raw 32-byte public key */
  pub: string;
  privateKey: KeyObject;
}

export interface SerializedIdentity {
  v: 1;
  pub: string;
  /** base64url raw 32-byte private scalar (JWK "d") */
  priv: string;
}

export function nodeIdFromPub(pub: string): string {
  return createHash("sha256").update(Buffer.from(pub, "base64url")).digest("hex").slice(0, 16);
}

export function generateIdentity(): NodeIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" }).x as string;
  return { id: nodeIdFromPub(pub), pub, privateKey };
}

export function serializeIdentity(identity: NodeIdentity): SerializedIdentity {
  const jwk = identity.privateKey.export({ format: "jwk" });
  return { v: 1, pub: identity.pub, priv: jwk.d as string };
}

export function deserializeIdentity(s: SerializedIdentity): NodeIdentity {
  const privateKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: s.pub, d: s.priv }, format: "jwk" });
  const pub = createPublicKey(privateKey).export({ format: "jwk" }).x as string;
  if (pub !== s.pub) throw new Error("identity file is corrupt: public key mismatch");
  return { id: nodeIdFromPub(pub), pub, privateKey };
}

export function signBytes(identity: NodeIdentity, data: Uint8Array): string {
  return edSign(null, data, identity.privateKey).toString("base64url");
}

const keyCache = new Map<string, KeyObject>();
function publicKeyObject(pub: string): KeyObject {
  let k = keyCache.get(pub);
  if (!k) {
    k = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub }, format: "jwk" });
    if (keyCache.size > 4096) keyCache.clear();
    keyCache.set(pub, k);
  }
  return k;
}

export function verifyBytes(pub: string, data: Uint8Array, sig: string): boolean {
  try {
    return edVerify(null, data, publicKeyObject(pub), Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}
