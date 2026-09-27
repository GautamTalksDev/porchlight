import { z } from "zod";
import { denyUnlessCoordinator } from "@/lib/auth";
import { setOutage } from "@/lib/city";

export const runtime = "nodejs";

/** Simulates the city side going dark: ingest answers 503, so every node holds what it hears. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  const parsed = z.object({ down: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "send { down: true | false }" }, { status: 400 });
  try {
    await setOutage(parsed.data.down);
    return Response.json({ ok: true, down: parsed.data.down });
  } catch (err) {
    return Response.json({ ok: false, reason: (err as Error).message }, { status: 500 });
  }
}
