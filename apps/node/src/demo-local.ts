import "./env";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NodeAgent } from "./agent";
import { createCityStub } from "./city-stub";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity-file";
import { createNodeServer } from "./server";

/**
 * One-laptop demo: three nodes on ports 7401, 7402 and 7403, fully meshed.
 * With CITY_URL set (for example http://localhost:3000 while the city app runs) they deliver to the real city.
 * Without it, a small stub city starts on port 7400 so the nodes still have somewhere to deliver.
 * Open http://localhost:7401 for the node console. Real beacon keys come from .env (BEACON_KEYS).
 */
const CITY_PORT = 7400;
const TOKEN = process.env.CITY_INGEST_TOKEN || "dev-only-token-change-me";
// Separate from DATA_DIR so demo runs never mix with a real node's log. Delete this folder to start fresh.
const base = process.env.DEMO_DATA_DIR ?? join(".", "data", "demo");
mkdirSync(base, { recursive: true });

const portInUse = (port: number) => (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Is another Porchlight demo still running? Stop it and try again.`);
    process.exit(1);
  }
  throw err;
};

const realCity = process.env.CITY_URL;
if (realCity) {
  console.log(`city       ${realCity} (the real city app)`);
} else {
  const city = createCityStub(TOKEN);
  city.server.on("error", portInUse(CITY_PORT));
  city.server.listen(CITY_PORT, "127.0.0.1", () => {
    console.log(`stub city  http://localhost:${CITY_PORT}/api/summary`);
    console.log(`           simulate a city outage: curl -X POST localhost:${CITY_PORT}/api/dev/outage -d '{"down":true}'`);
  });
}

const names = ["node-a", "node-b", "node-c"] as const;
const ports = [7401, 7402, 7403];
const nodeHomes: Record<(typeof names)[number], string> = {
  "node-a": "hh-oak-19",
  "node-b": "hh-birch-4",
  "node-c": "hh-cedar-31",
};
const agents: NodeAgent[] = [];
names.forEach((name, i) => {
  const peers = ports.filter((_, j) => j !== i).map((p) => `http://127.0.0.1:${p}`).join(",");
  const config = loadConfig(
    {
      ...process.env,
      NODE_NAME: name,
      NODE_HOUSEHOLD: nodeHomes[name],
      PORT: String(ports[i]),
      HOST: "127.0.0.1",
      DATA_DIR: join(base, name),
      PEERS: peers,
      CITY_URL: realCity || `http://127.0.0.1:${CITY_PORT}`,
      CITY_INGEST_TOKEN: TOKEN,
      DEV_SIMULATE_BEACON: process.env.DEV_SIMULATE_BEACON ?? "true",
      BEACON_KEYS: process.env.BEACON_KEYS || "pl-b01:000102030405060708090a0b0c0d0e0f",
    },
  );
  const agent = new NodeAgent(config, loadOrCreateIdentity(config.dataDir));
  const { server } = createNodeServer(agent);
  server.on("error", portInUse(config.port));
  server.listen(config.port, config.host, () => console.log(`${name}     http://localhost:${config.port}`));
  agent.start();
  agents.push(agent);
});

process.on("SIGINT", () => {
  for (const a of agents) a.stop();
  process.exit(0);
});
