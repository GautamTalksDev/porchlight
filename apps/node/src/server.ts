import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ExchangeRequest, PullRequest, PushRequest, handleExchange, handlePull, handlePush } from "@porchlight/protocol";
import type { NodeAgent } from "./agent";
import { HttpError, RateLimiter, SECURITY_HEADERS, macMatches, parseJson, readBody, sendJson } from "./net";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");
const require = createRequire(import.meta.url);
const FONT_DIRS: Record<string, string> = {
  next: join(dirname(require.resolve("@fontsource-variable/atkinson-hyperlegible-next/package.json")), "files"),
  mono: join(dirname(require.resolve("@fontsource-variable/atkinson-hyperlegible-mono/package.json")), "files"),
};

/** Pre-recorded voice clips present on disk, so the console only requests files that exist. */
export function availableClips(): Record<"en" | "fr", string[]> {
  const out: Record<"en" | "fr", string[]> = { en: [], fr: [] };
  for (const lang of ["en", "fr"] as const) {
    const dir = join(PUBLIC_DIR, "audio", lang);
    if (!existsSync(dir)) continue;
    out[lang] = readdirSync(dir).filter((f) => /^[a-z0-9-]{1,40}\.mp3$/.test(f)).map((f) => f.slice(0, -4));
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/**
 * Map a request path to a single file name under apps/node/public (no subfolders).
 * Every .js file at the public root is served so console modules can import each other
 * without a hand-maintained allow list. CSS and the favicon stay explicit.
 * Returns null when the path must not be served from the public root.
 */
export function resolvePublicRootFile(pathname: string): string | null {
  if (pathname === "/styles.css" || pathname === "/favicon.svg") return pathname.slice(1);
  // One segment only: letters, digits, dot, underscore, hyphen; must end in .js.
  const m = /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,62}\.js)$/.exec(pathname);
  if (!m) return null;
  const name = m[1]!;
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  return name;
}

const BeaconBody = z.strictObject({
  beaconId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
  frame: z.string().regex(/^[0-9a-f]{36}$/),
  rssi: z.number().int().min(-127).max(20).optional(),
  via: z.enum(["ble", "serial", "sim"]),
});
const CheckinBody = z.strictObject({
  household: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
  kind: z.enum(["help", "ok"]),
  note: z.string().max(280).optional(),
});
const AckBody = z.strictObject({ incident: z.string().regex(/^[a-z0-9:-]{3,96}$/) });
const ReplyBody = z.strictObject({
  incident: z.string().regex(/^[a-z0-9:-]{3,96}$/),
  reply: z.enum(["omw", "cant", "generator", "blocked"]),
  note: z.string().max(140).optional(),
});
const UplinkBody = z.strictObject({ cut: z.boolean() });
const ChaosBody = z.strictObject({ drop: z.number().min(0).max(0.95) });
const DevBeaconBody = z.strictObject({ beaconId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/), kind: z.enum(["help", "ok", "test", "fall"]) });

function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, `invalid request: ${r.error.issues[0]?.path.join(".") || ""} ${r.error.issues[0]?.message ?? ""}`.trim());
  return r.data;
}

export function createNodeServer(agent: NodeAgent): { server: Server; sessionToken: string } {
  const sessionToken = randomBytes(24).toString("base64url");
  const peerLimiter = new RateLimiter(60, 20);
  const localLimiter = new RateLimiter(40, 10);
  const indexTemplate = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");

  const requireLocal = (req: IncomingMessage, write: boolean) => {
    if (!isLoopback(req) && !agent.config.uiPublic) throw new HttpError(403, "console is only available on this device");
    if (write) {
      if (req.headers["x-porchlight-token"] !== sessionToken) throw new HttpError(401, "missing or stale session token, reload the page");
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host && new URL(origin).host !== host) throw new HttpError(403, "cross-origin request blocked");
      if (!localLimiter.take(req.socket.remoteAddress ?? "local")) throw new HttpError(429, "slow down");
    }
  };

  const requireConsoleOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host && new URL(origin).host !== host) throw new HttpError(403, "cross-origin request blocked");
  };

  const serveFile = (res: ServerResponse, path: string, cache = "no-cache") => {
    if (!existsSync(path) || !statSync(path).isFile()) throw new HttpError(404, "not found");
    const ext = path.slice(path.lastIndexOf("."));
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": cache });
    res.end(readFileSync(path));
  };

  const sseClients = new Set<ServerResponse>();
  let pending: NodeJS.Timeout | undefined;
  agent.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      const data = `event: state\ndata: ${JSON.stringify(agent.state())}\n\n`;
      for (const c of sseClients) c.write(data);
    }, 120);
  });
  agent.onBeaconAck(({ beaconId, frame }) => {
    const data = `event: beacon-ack\ndata: ${JSON.stringify({ beaconId, frame })}\n\n`;
    for (const c of sseClients) c.write(data);
  });
  // Heartbeat: gossip with peers that are already in sync changes no data, so push the full state
  // every 2 seconds anyway. Peer health and "last delivered" times then stay true on screen.
  setInterval(() => {
    if (!sseClients.size) return;
    const data = `event: state\ndata: ${JSON.stringify(agent.state())}\n\n`;
    for (const c of sseClients) c.write(data);
  }, 2_000).unref();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://node.local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Peer-facing sync API
    if (path.startsWith("/sync/")) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      if (!peerLimiter.take(req.socket.remoteAddress ?? "?")) throw new HttpError(429, "slow down");
      if (Math.random() < agent.chaosDrop) throw new HttpError(503, "dropped by chaos");
      const raw = await readBody(req);
      if (!macMatches(agent.config.networkKey, raw, req.headers["x-porchlight-mac"] as string | undefined)) {
        throw new HttpError(401, "bad network MAC");
      }
      const body = parseJson(raw);
      switch (path) {
        case "/sync/exchange":
          return sendJson(res, 200, handleExchange(agent.store, agent.identity.id, parseWith(ExchangeRequest, body)));
        case "/sync/push":
          return sendJson(res, 200, handlePush(agent.store, parseWith(PushRequest, body)));
        case "/sync/pull":
          return sendJson(res, 200, handlePull(agent.store, parseWith(PullRequest, body)));
      }
      throw new HttpError(404, "not found");
    }

    if (path === "/healthz") return sendJson(res, 200, { ok: true, id: agent.identity.id, name: agent.config.name });

    // Local console
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      requireLocal(req, false);
      const html = indexTemplate.replaceAll("__SESSION_TOKEN__", sessionToken).replaceAll("__NODE_NAME__", agent.config.name);
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": MIME[".html"]!, "cache-control": "no-store" });
      return res.end(html);
    }
    const rootFile = resolvePublicRootFile(path);
    if (method === "GET" && rootFile) {
      return serveFile(res, join(PUBLIC_DIR, rootFile));
    }
    let m = /^\/audio\/(en|fr)\/([a-z0-9-]{1,40}\.mp3)$/.exec(path);
    if (method === "GET" && m) return serveFile(res, normalize(join(PUBLIC_DIR, "audio", m[1]!, m[2]!)), "public, max-age=3600");
    m = /^\/fonts\/(next|mono)\/([a-z0-9-]{1,80}\.woff2)$/.exec(path);
    if (method === "GET" && m) return serveFile(res, join(FONT_DIRS[m[1]!]!, m[2]!), "public, max-age=31536000, immutable");

    if (path === "/api/state" && method === "GET") {
      requireLocal(req, false);
      return sendJson(res, 200, agent.state());
    }
    if (path === "/api/session" && method === "GET") {
      requireLocal(req, false);
      requireConsoleOrigin(req);
      return sendJson(res, 200, { token: sessionToken });
    }
    if (path === "/api/clips" && method === "GET") {
      requireLocal(req, false);
      return sendJson(res, 200, availableClips());
    }
    if (path === "/api/stream" && method === "GET") {
      requireLocal(req, false);
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: state\ndata: ${JSON.stringify(agent.state())}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (method === "POST" && path.startsWith("/api/")) {
      requireLocal(req, true);
      const body = parseJson(await readBody(req, 16_000));
      switch (path) {
        case "/api/beacon": {
          const out = agent.handleBeacon(parseWith(BeaconBody, body));
          return sendJson(res, out.ok ? 200 : out.status, out);
        }
        case "/api/checkin": {
          const b = parseWith(CheckinBody, body);
          try {
            const ev = agent.consoleCheckin(b.household, b.kind, b.note);
            return sendJson(res, 200, { ok: true, eventId: ev.id });
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
        }
        case "/api/ack": {
          const b = parseWith(AckBody, body);
          try {
            const r = agent.acknowledge(b.incident);
            return sendJson(res, 200, { ok: true, eventId: r.event.id, ackFrame: r.ackFrame ?? null });
          } catch (err) {
            throw new HttpError(404, (err as Error).message);
          }
        }
        case "/api/reply": {
          const b = parseWith(ReplyBody, body);
          try {
            const r = agent.reply(b.incident, b.reply, b.note);
            return sendJson(res, 200, {
              ok: true,
              eventId: r.reply.id,
              ackEventId: r.ack?.id ?? null,
              ackFrame: r.ackFrame ?? null,
            });
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
        }
        case "/api/uplink":
          agent.setUplinkCut(parseWith(UplinkBody, body).cut);
          return sendJson(res, 200, { ok: true, mode: agent.uplinkMode });
        case "/api/dev/beacon": {
          // Development only: lets the team exercise the full beacon path without the Arduino.
          if (!agent.config.devSimulateBeacon) throw new HttpError(404, "not found");
          const b = parseWith(DevBeaconBody, body);
          const out = agent.simulateBeaconPress(b.beaconId, b.kind);
          return sendJson(res, out.ok ? 200 : out.status, out);
        }
        case "/api/chaos":
          agent.setChaos(parseWith(ChaosBody, body).drop);
          return sendJson(res, 200, { ok: true, drop: agent.chaosDrop });
      }
    }
    throw new HttpError(404, "not found");
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "internal error";
      if (status === 500) console.error("[node] unhandled", err);
      if (!res.headersSent) sendJson(res, status, { ok: false, reason: message });
      else res.end();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return { server, sessionToken };
}
