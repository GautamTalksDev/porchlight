import { denyUnlessOpen311 } from "@/lib/open311-access";
import { findOpen311Request } from "@/lib/open311";
import { loadOpen311Requests } from "@/lib/open311-load";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Open311 GeoReport v2 single service request. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = await denyUnlessOpen311(req);
  if (denied) return denied;
  if (!allow(`open311:${clientKey(req)}`, 30, 5)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!id || id.length > 120) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  const hit = findOpen311Request(await loadOpen311Requests(), decodeURIComponent(id));
  if (!hit) return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  return Response.json(hit);
}
