import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { EventStore, project } from "@porchlight/protocol";
import { HttpError, readBody, parseJson, sendJson } from "./net";

/**
 * A minimal stand-in for the city ingest API, for local development and tests.
 * The real city app (apps/city) implements the same contract with Tiger Data behind it.
 *   POST /api/ingest  Authorization: Bearer <token>  { node: {id, name}, events: SignedEvent[] }
 *   → { accepted: string[], duplicates: string[], rejected: {id, reason}[] }
 */
export function createCityStub(token: string): { server: Server; store: EventStore; down: { value: boolean } } {
  const store = new EventStore();
  const down = { value: false };
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? "/", "http://city.local");
      // Local development only: simulate the city going dark for every node at once.
      if (req.method === "POST" && url.pathname === "/api/dev/outage") {
        const body = parseJson(await readBody(req, 1000)) as { down?: unknown };
        down.value = body.down === true;
        return sendJson(res, 200, { down: down.value });
      }
      if (down.value) throw new HttpError(503, "city is down");
      if (req.method === "POST" && url.pathname === "/api/ingest") {
        const auth = Buffer.from(req.headers.authorization ?? "");
        if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new HttpError(401, "bad token");
        const body = parseJson(await readBody(req)) as { events?: unknown[] };
        if (!Array.isArray(body.events) || body.events.length > 250) throw new HttpError(400, "events must be an array of at most 250");
        const accepted: string[] = [];
        const duplicates: string[] = [];
        const rejected: { id: string; reason: string }[] = [];
        for (const ev of body.events) {
          const id = String((ev as { id?: unknown })?.id ?? "");
          const r = store.add(ev);
          if (r.added) accepted.push(id);
          else if (r.reason === "duplicate") duplicates.push(id);
          else rejected.push({ id, reason: r.reason });
        }
        return sendJson(res, 200, { accepted, duplicates, rejected });
      }
      if (req.method === "GET" && url.pathname === "/api/summary") {
        return sendJson(res, 200, { events: store.size, ...project(store.all()) });
      }
      throw new HttpError(404, "not found");
    })().catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      sendJson(res, status, { ok: false, reason: err instanceof Error ? err.message : "error" });
    });
  });
  return { server, store, down };
}
