import "./env";
import { randomBytes } from "node:crypto";

/** Prints a fresh beacon key for the node .env and the matching firmware config line. */
const beaconId = process.argv[2] ?? "pl-b01";
if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(beaconId)) {
  console.error("beacon id must be lowercase letters, digits and dashes, e.g. pl-b01");
  process.exit(1);
}
const key = randomBytes(16);
const hex = key.toString("hex");
console.log("\n# Node .env");
console.log(`BEACON_KEYS=${beaconId}:${hex}`);
console.log("\n// firmware/porchlight-beacon/config.h");
console.log(`#define BEACON_ID "${beaconId}"`);
console.log(`static const uint8_t BEACON_KEY[16] = { ${[...key].map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(", ")} };\n`);
