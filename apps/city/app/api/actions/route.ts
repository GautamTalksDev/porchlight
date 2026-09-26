import { z } from "zod";
import { denyUnlessCoordinator } from "@/lib/auth";
import { cityAction } from "@/lib/city";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  kind: z.enum(["ok", "ack"]),
  household: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
  incident: z.string().regex(/^[a-z0-9:-]{3,96}$/).optional(),
  note: z.string().max(280).optional(),
});

/** Coordinator (or voice agent tool) actions. Each becomes a signed city event in the log. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`actions:${clientKey(req)}`, 20, 2)) return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid action" }, { status: 400 });
  try {
    const ev = await cityAction(parsed.data.kind, parsed.data.household, parsed.data);
    return Response.json({ ok: true, eventId: ev.id });
  } catch (err) {
    return Response.json({ ok: false, reason: (err as Error).message }, { status: 409 });
  }
}
