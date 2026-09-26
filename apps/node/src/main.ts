import "./env";
import { NodeAgent } from "./agent";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity-file";
import { createNodeServer } from "./server";

const config = loadConfig();
const identity = loadOrCreateIdentity(config.dataDir);
const agent = new NodeAgent(config, identity);
const { server } = createNodeServer(agent);
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Set a different PORT in .env or stop the other process.`);
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, config.host, () => {
  console.log(`Porchlight node "${config.name}" (${identity.id})`);
  console.log(`  console: http://localhost:${config.port}`);
  console.log(`  peers:   ${config.peers.join(", ") || "(none)"}`);
  console.log(`  city:    ${config.cityUrl ?? "(no uplink configured)"}`);
  console.log(`  beacons: ${[...config.beaconKeys.keys()].join(", ") || "(none)"}`);
  if (config.uiPublic) console.warn("  warning: UI_PUBLIC=true exposes the console to your whole network");
  agent.start();
});

const shutdown = () => {
  agent.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
