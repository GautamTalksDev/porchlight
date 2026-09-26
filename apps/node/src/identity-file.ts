import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserializeIdentity, generateIdentity, serializeIdentity, type NodeIdentity } from "@porchlight/protocol";

/** Loads this node's Ed25519 key, creating it on first boot. The file is owner-read-only. */
export function loadOrCreateIdentity(dataDir: string): NodeIdentity {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "identity.json");
  if (existsSync(path)) return deserializeIdentity(JSON.parse(readFileSync(path, "utf8")));
  const id = generateIdentity();
  writeFileSync(path, JSON.stringify(serializeIdentity(id)), { mode: 0o600 });
  chmodSync(path, 0o600);
  return id;
}
