import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EventStore,
  HybridClock,
  createEvent,
  generateIdentity,
  handleExchange,
  handlePull,
  handlePush,
  syncWith,
  type NodeIdentity,
  type SyncTransport,
} from "@porchlight/protocol";

/**
 * Chaos harness. Builds a neighbourhood of N nodes where each node can only reach a few
 * physical neighbours, drops a fraction of every message, takes random nodes offline, and
 * repeatedly cuts the city uplink while residents call for help. Then it counts what was lost.
 */

interface Args {
  nodes: number;
  loss: number;
  cycles: number;
  churn: number;
  gateways: number;
  outageRounds: number;
  eventsPerCycle: number;
  seed: number;
  intervalMs: number;
  assert: boolean;
}

/** Arguments are plain words: `npm run sim nodes=50 loss=0.4 cycles=100`, and `assert` to fail on any loss. */
function parseArgs(argv: string[]): Args {
  const kv = new Map(argv.filter((a) => a.includes("=")).map((a) => a.split("=", 2) as [string, string]));
  const get = (name: string, dflt: number) => {
    const v = kv.get(name);
    return v === undefined ? dflt : Number(v);
  };
  return {
    nodes: get("nodes", 30),
    loss: get("loss", 0.3),
    cycles: get("cycles", 50),
    churn: get("churn", 0.05),
    gateways: get("gateways", 0.2),
    outageRounds: get("outage", 20),
    eventsPerCycle: get("events", 4),
    seed: get("seed", 20260926),
    intervalMs: get("interval", 1500),
    assert: argv.includes("assert"),
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimNode {
  idx: number;
  identity: NodeIdentity;
  clock: HybridClock;
  store: EventStore;
  neighbours: number[];
  gateway: boolean;
  online: boolean;
  uplinked: Set<string>;
}

class Dropped extends Error {}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

export async function simulate(args: Args) {
  const rand = mulberry32(args.seed);
  let virtualNow = 1_790_000_000_000;
  const now = () => virtualNow;

  // Random geometric neighbourhood: each node reaches its 3 nearest neighbours (Wi-Fi range), then we
  // stitch components together so the street is connected, but only through multi-hop paths.
  const pos = Array.from({ length: args.nodes }, () => [rand(), rand()] as const);
  const nodes: SimNode[] = pos.map((_, idx) => {
    const identity = generateIdentity();
    return {
      idx,
      identity,
      clock: new HybridClock(identity.id, now),
      store: new EventStore(undefined, () => ({ now: virtualNow })),
      neighbours: [],
      gateway: false,
      online: true,
      uplinked: new Set(),
    };
  });
  const dist = (a: number, b: number) => Math.hypot(pos[a]![0] - pos[b]![0], pos[a]![1] - pos[b]![1]);
  const link = (a: number, b: number) => {
    if (a === b || nodes[a]!.neighbours.includes(b)) return;
    nodes[a]!.neighbours.push(b);
    nodes[b]!.neighbours.push(a);
  };
  for (const n of nodes) {
    const nearest = nodes.map((m) => m.idx).filter((i) => i !== n.idx).sort((a, b) => dist(n.idx, a) - dist(n.idx, b)).slice(0, 3);
    for (const m of nearest) link(n.idx, m);
  }
  const component = (start: number) => {
    const seen = new Set([start]);
    const q = [start];
    while (q.length) for (const nb of nodes[q.shift()!]!.neighbours) if (!seen.has(nb)) (seen.add(nb), q.push(nb));
    return seen;
  };
  for (let comp = component(0); comp.size < args.nodes; comp = component(0)) {
    let best: [number, number, number] = [0, 0, Infinity];
    for (const a of comp) for (const b of nodes.map((m) => m.idx)) if (!comp.has(b) && dist(a, b) < best[2]) best = [a, b, dist(a, b)];
    link(best[0], best[1]);
  }
  const gatewayCount = Math.max(1, Math.round(args.nodes * args.gateways));
  for (const i of [...nodes.keys()].sort(() => rand() - 0.5).slice(0, gatewayCount)) nodes[i]!.gateway = true;

  const city = new EventStore(undefined, () => ({ now: virtualNow }));
  let cityUp = true;
  let messages = 0;
  let dropped = 0;

  const transport = (to: SimNode): SyncTransport => {
    const gate = () => {
      messages++;
      if (!to.online || rand() < args.loss) {
        dropped++;
        throw new Dropped();
      }
    };
    return {
      async exchange(req) { gate(); return handleExchange(to.store, to.identity.id, req); },
      async push(req) { gate(); return handlePush(to.store, req); },
      async pull(req) { gate(); return handlePull(to.store, req); },
    };
  };

  const injectedAt = new Map<string, number>();
  const fullyReplicatedAt = new Map<string, number>();
  const atCityAt = new Map<string, number>();
  const recoveryRounds: number[] = [];
  let round = 0;

  const step = async () => {
    round++;
    virtualNow += args.intervalMs;
    for (const n of nodes) n.online = rand() >= args.churn;
    for (const n of nodes) {
      if (!n.online) continue;
      const peers = [...n.neighbours].sort(() => rand() - 0.5).slice(0, 2);
      for (const p of peers) {
        try {
          await syncWith(n.store, n.identity.id, transport(nodes[p]!));
        } catch (e) {
          if (!(e instanceof Dropped)) throw e;
        }
      }
      if (n.gateway && cityUp) {
        messages++;
        if (rand() < args.loss) {
          dropped++;
        } else {
          for (const ev of n.store.all()) {
            if (n.uplinked.has(ev.id)) continue;
            city.add(ev);
            n.uplinked.add(ev.id);
          }
        }
      }
    }
    for (const id of injectedAt.keys()) {
      if (!fullyReplicatedAt.has(id) && nodes.every((n) => n.store.has(id))) fullyReplicatedAt.set(id, round);
      if (!atCityAt.has(id) && city.has(id)) atCityAt.set(id, round);
    }
  };

  const t0 = performance.now();
  for (let c = 0; c < args.cycles; c++) {
    cityUp = false;
    for (let r = 0; r < args.outageRounds; r++) {
      if (r < args.eventsPerCycle) {
        const n = nodes[Math.floor(rand() * nodes.length)]!;
        const ev = createEvent(n.identity, n.clock, {
          kind: "help",
          household: `hh-sim-${Math.floor(rand() * 500)}`,
          incident: `sim-${c}-${r}-${n.identity.id.slice(0, 6)}`,
          source: { type: "sim" },
        });
        n.store.add(ev);
        injectedAt.set(ev.id, round);
      }
      await step();
    }
    cityUp = true;
    const restoredAt = round;
    let guard = 0;
    while ([...injectedAt.keys()].some((id) => !city.has(id)) && guard++ < 500) await step();
    recoveryRounds.push(round - restoredAt);
  }
  // Let replication settle so the "every node has everything" check is fair.
  let settle = 0;
  while ([...injectedAt.keys()].some((id) => !fullyReplicatedAt.has(id)) && settle++ < 500) await step();

  const injected = injectedAt.size;
  const lost = [...injectedAt.keys()].filter((id) => !city.has(id)).length;
  const toSec = (r: number) => Math.round(((r * args.intervalMs) / 1000) * 10) / 10;
  const propagation = [...fullyReplicatedAt.entries()].map(([id, r]) => r - injectedAt.get(id)!);
  const report = {
    generatedAt: new Date().toISOString(),
    params: args,
    topology: {
      nodes: args.nodes,
      gateways: gatewayCount,
      avgNeighbours: Math.round((nodes.reduce((s, n) => s + n.neighbours.length, 0) / nodes.length) * 10) / 10,
    },
    results: {
      eventsInjected: injected,
      eventsAtCity: injected - lost,
      eventsLost: lost,
      messagesSent: messages,
      messagesDropped: dropped,
      measuredLossRate: Math.round((dropped / Math.max(1, messages)) * 1000) / 1000,
      propagationSeconds: { p50: toSec(percentile(propagation, 50)), p95: toSec(percentile(propagation, 95)), max: toSec(Math.max(0, ...propagation)) },
      recoveryAfterOutageSeconds: { p50: toSec(percentile(recoveryRounds, 50)), p95: toSec(percentile(recoveryRounds, 95)), max: toSec(Math.max(0, ...recoveryRounds)) },
      outageCycles: args.cycles,
      wallClockMs: Math.round(performance.now() - t0),
    },
  };
  return report;
}

const isMain = process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const report = await simulate(args);
  const r = report.results;
  mkdirSync("reports", { recursive: true });
  writeFileSync(join("reports", "sim-latest.json"), JSON.stringify(report, null, 2));
  console.log(`\nPorchlight chaos run: ${args.nodes} nodes, ${Math.round(args.loss * 100)}% message loss, ${Math.round(args.churn * 100)}% node churn, ${args.cycles} city outages\n`);
  console.log(`  alerts raised during outages   ${r.eventsInjected}`);
  console.log(`  alerts delivered to the city   ${r.eventsAtCity}`);
  console.log(`  alerts lost                    ${r.eventsLost}`);
  console.log(`  messages dropped               ${r.messagesDropped} of ${r.messagesSent} (${Math.round(r.measuredLossRate * 100)}%)`);
  console.log(`  reached every node             p50 ${r.propagationSeconds.p50}s, p95 ${r.propagationSeconds.p95}s`);
  console.log(`  city caught up after restore   p50 ${r.recoveryAfterOutageSeconds.p50}s, p95 ${r.recoveryAfterOutageSeconds.p95}s`);
  console.log(`  (simulated at ${args.intervalMs} ms per gossip round; ran in ${r.wallClockMs} ms)\n`);
  if (args.assert && r.eventsLost > 0) {
    console.error("FAIL: alerts were lost");
    process.exit(1);
  }
}
