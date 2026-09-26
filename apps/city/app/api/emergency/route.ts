import { z } from "zod";
import { denyUnlessCoordinator } from "@/lib/auth";
import { setEmergency } from "@/lib/city";

export const runtime = "nodejs";

/** Starts or ends the emergency clock used for proactive wellness checks. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  const parsed = z.object({ active: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "send { active: true | false }" }, { status: 400 });
  const since = await setEmergency(parsed.data.active);
  return Response.json({ ok: true, active: parsed.data.active, emergencySince: since });
}
