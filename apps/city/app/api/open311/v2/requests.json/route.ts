import { z } from "zod";
import { denyUnlessOpen311 } from "@/lib/open311-access";
import { filterOpen311Requests, OPEN311_SERVICE_CODES } from "@/lib/open311";
import { loadOpen311Requests } from "@/lib/open311-load";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(["open", "closed"]).optional(),
  service_code: z.enum(OPEN311_SERVICE_CODES).optional(),
  start_date: z.string().min(1).max(40).optional(),
  end_date: z.string().min(1).max(40).optional(),
});

/** Open311 GeoReport v2 service request list. */
export async function GET(req: Request) {
  const denied = await denyUnlessOpen311(req);
  if (denied) return denied;
  if (!allow(`open311:${clientKey(req)}`, 30, 5)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    service_code: url.searchParams.get("service_code") ?? undefined,
    start_date: url.searchParams.get("start_date") ?? undefined,
    end_date: url.searchParams.get("end_date") ?? undefined,
  });
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid query" }, { status: 400 });
  const all = await loadOpen311Requests();
  return Response.json(filterOpen311Requests(all, parsed.data));
}
