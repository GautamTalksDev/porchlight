import { denyUnlessCoordinator } from "@/lib/auth";
import { resetDemo } from "@/lib/city";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wipe demo state for a clean rehearsal. Only when DEMO_RESET_ENABLED=true. */
export async function POST(req: Request) {
  if (process.env.DEMO_RESET_ENABLED !== "true") {
    return Response.json({ ok: false, reason: "not found" }, { status: 404 });
  }
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`demo-reset:${clientKey(req)}`, 5, 60)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  try {
    await resetDemo();
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[demo/reset]", (err as Error).message);
    return Response.json({ ok: false, reason: (err as Error).message }, { status: 503 });
  }
}
