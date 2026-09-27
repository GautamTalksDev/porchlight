import { denyUnlessOpen311 } from "@/lib/open311-access";
import { OPEN311_SERVICES } from "@/lib/open311";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open311 GeoReport v2 service discovery. */
export async function GET(req: Request) {
  const denied = await denyUnlessOpen311(req);
  if (denied) return denied;
  if (!allow(`open311:${clientKey(req)}`, 30, 5)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  return Response.json(OPEN311_SERVICES);
}
