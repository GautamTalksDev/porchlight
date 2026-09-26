import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { city, ingest } from "@/lib/city";
import { allow, clientKey, readJsonLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  node: z.object({ id: z.string().regex(/^[0-9a-f]{16}$/), name: z.string().regex(/^[a-z0-9-]{2,32}$/) }),
  events: z.array(z.unknown()).max(250),
  /** City notice ids this node already holds (proof of delivery). */
  heldNotices: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(200).optional(),
});

function tokenOk(header: string | null): boolean {
  const expected = process.env.CITY_INGEST_TOKEN;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Nodes deliver batches of signed events here. Contract documented in docs/PROTOCOL.md. */
export async function POST(req: Request) {
  if (!allow(`ingest:${clientKey(req)}`, 30, 10)) return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  if (!tokenOk(req.headers.get("authorization"))) return Response.json({ ok: false, reason: "bad token" }, { status: 401 });
  await city().ready;
  if (city().outage) return Response.json({ ok: false, reason: "city link is down (simulated outage)" }, { status: 503 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJsonLimited(req, 1_000_000));
  } catch (err) {
    const status = err instanceof RangeError ? 413 : 400;
    return Response.json({ ok: false, reason: "invalid batch" }, { status });
  }
  try {
    return Response.json(await ingest(body.node, body.events, body.heldNotices ?? []));
  } catch (err) {
    console.error("[ingest] storage failed, node will retry:", (err as Error).message);
    return Response.json({ ok: false, reason: "storage unavailable, retry later" }, { status: 503 });
  }
}
