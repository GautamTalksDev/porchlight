import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HybridClock, deserializeIdentity, generateIdentity, serializeIdentity, type NodeIdentity } from "@porchlight/protocol";

interface CityIdentity {
  identity: NodeIdentity;
  clock: HybridClock;
}

const g = globalThis as unknown as { __plCityIdentity?: CityIdentity };

/**
 * The city signs its own actions (a coordinator marking someone safe, a voice agent confirming a
 * check-in) exactly like a node does, so every change in the log is attributable and verifiable.
 * Key source: CITY_IDENTITY (JSON from `npm run keygen city`) or a file in CITY_DATA_DIR.
 */
export function cityIdentity(): CityIdentity {
  if (g.__plCityIdentity) return g.__plCityIdentity;
  let identity: NodeIdentity;
  if (process.env.CITY_IDENTITY) {
    identity = deserializeIdentity(JSON.parse(Buffer.from(process.env.CITY_IDENTITY, "base64").toString("utf8")));
  } else {
    const dir = process.env.CITY_DATA_DIR ?? join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "city-identity.json");
    if (existsSync(path)) identity = deserializeIdentity(JSON.parse(readFileSync(path, "utf8")));
    else {
      identity = generateIdentity();
      writeFileSync(path, JSON.stringify(serializeIdentity(identity)), { mode: 0o600 });
    }
  }
  g.__plCityIdentity = { identity, clock: new HybridClock(identity.id) };
  return g.__plCityIdentity;
}
