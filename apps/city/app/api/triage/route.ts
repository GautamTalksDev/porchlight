import { denyUnlessCoordinator } from "@/lib/auth";
import { snapshot } from "@/lib/city";
import { allow, clientKey } from "@/lib/ratelimit";
import { triage } from "@/lib/triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`triage:${clientKey(req)}`, 6, 0.5)) return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  return Response.json(await triage(await snapshot()));
}
