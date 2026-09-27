import { readFileSync } from "node:fs";
import { z } from "zod";
import { hexToBytes } from "@porchlight/protocol";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const EnvSchema = z.object({
  NODE_NAME: z.string().regex(/^[a-z0-9-]{2,32}$/).default("node-a"),
  /** Household this node sits in (Porch Circles buddy matching). */
  NODE_HOUSEHOLD: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/).optional().or(z.literal("").transform(() => undefined)),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(7401),
  DATA_DIR: z.string().default("./data"),
  PEERS: z.string().default(""),
  CITY_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  CITY_INGEST_TOKEN: z.string().default(""),
  /** Optional pinned city origin id (16 hex). When empty, the node learns it from the first uplink. */
  CITY_ID: z.string().regex(/^[0-9a-f]{16}$/).optional().or(z.literal("").transform(() => undefined)),
  NETWORK_KEY: z.string().default(""),
  ROSTER: z.string().default(""),
  BEACON_KEYS: z.string().default(""),
  HOUSEHOLDS_FILE: z.string().default("./config/households.json"),
  GOSSIP_INTERVAL_MS: z.coerce.number().int().min(200).default(1500),
  GOSSIP_FANOUT: z.coerce.number().int().min(1).max(8).default(2),
  UPLINK_INTERVAL_MS: z.coerce.number().int().min(500).default(2000),
  CHAOS_DROP: z.coerce.number().min(0).max(0.95).default(0),
  UI_PUBLIC: bool,
  DEV_SIMULATE_BEACON: bool,
  DEFAULT_LANG: z.enum(["en", "fr"]).default("en"),
  /** Seconds before a call escalates from buddies to the whole street. Use 30 for demos. */
  BUDDY_WINDOW_SEC: z.coerce.number().int().min(1).default(300),
  /** Seconds the street window lasts before the city tier. Use 30 for demos. */
  STREET_WINDOW_SEC: z.coerce.number().int().min(1).default(300),
});

export interface HouseholdInfo {
  label: string;
  lang: "en" | "fr";
  buddies: string[];
}

export const RosterFile = z.object({
  beacons: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/), z.object({ household: z.string() })),
  households: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
    z.object({
      label: z.string().max(80),
      lang: z.enum(["en", "fr"]).default("en"),
      /** Fictional demo needs so the console can show offline guidance. Real deployments may omit these. */
      needs: z.array(z.string()).default([]),
      buddies: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/)).default([]),
    }),
  ),
});
export type RosterFile = z.infer<typeof RosterFile>;

export interface NodeConfig {
  name: string;
  household?: string;
  host: string;
  port: number;
  dataDir: string;
  peers: string[];
  cityUrl?: string;
  cityToken: string;
  /** Optional pre-pinned city origin id for accepting notices before the first uplink. */
  cityId?: string;
  networkKey: string;
  roster?: Set<string>;
  beaconKeys: Map<string, Uint8Array>;
  households: RosterFile;
  gossipIntervalMs: number;
  gossipFanout: number;
  uplinkIntervalMs: number;
  chaosDrop: number;
  uiPublic: boolean;
  devSimulateBeacon: boolean;
  defaultLang: "en" | "fr";
  buddyWindowSec: number;
  streetWindowSec: number;
}

export function parseBeaconKeys(spec: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, hex] = part.split(":");
    if (!id || !hex || !/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`BEACON_KEYS entry "${id ?? part}" must look like pl-b01:<32 hex chars>`);
    out.set(id, hexToBytes(hex.toLowerCase()));
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<NodeConfig> = {}): NodeConfig {
  const e = EnvSchema.parse(env);
  let households: RosterFile = { beacons: {}, households: {} };
  try {
    households = RosterFile.parse(JSON.parse(readFileSync(e.HOUSEHOLDS_FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`HOUSEHOLDS_FILE is invalid: ${(err as Error).message}`);
  }
  if (e.CITY_URL && !e.CITY_INGEST_TOKEN) {
    throw new Error("CITY_URL is set but CITY_INGEST_TOKEN is empty. Uplink needs a token.");
  }
  if (e.NODE_HOUSEHOLD && !households.households[e.NODE_HOUSEHOLD]) {
    throw new Error(`NODE_HOUSEHOLD "${e.NODE_HOUSEHOLD}" is not in HOUSEHOLDS_FILE`);
  }
  const roster = e.ROSTER.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    name: e.NODE_NAME,
    household: e.NODE_HOUSEHOLD,
    host: e.HOST,
    port: e.PORT,
    dataDir: e.DATA_DIR,
    peers: e.PEERS.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    cityUrl: e.CITY_URL?.replace(/\/$/, ""),
    cityToken: e.CITY_INGEST_TOKEN,
    cityId: e.CITY_ID,
    networkKey: e.NETWORK_KEY,
    roster: roster.length ? new Set(roster) : undefined,
    beaconKeys: parseBeaconKeys(e.BEACON_KEYS),
    households,
    gossipIntervalMs: e.GOSSIP_INTERVAL_MS,
    gossipFanout: e.GOSSIP_FANOUT,
    uplinkIntervalMs: e.UPLINK_INTERVAL_MS,
    chaosDrop: e.CHAOS_DROP,
    uiPublic: e.UI_PUBLIC,
    devSimulateBeacon: e.DEV_SIMULATE_BEACON,
    defaultLang: e.DEFAULT_LANG,
    buddyWindowSec: e.BUDDY_WINDOW_SEC,
    streetWindowSec: e.STREET_WINDOW_SEC,
    ...overrides,
  };
}
