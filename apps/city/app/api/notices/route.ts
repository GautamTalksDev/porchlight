import { z } from "zod";
import { NoticeSeverity } from "@porchlight/protocol";
import { denyUnlessCoordinator } from "@/lib/auth";
import { publishNotice } from "@/lib/city";
import { noticePublishHttpError } from "@/lib/city-notices";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  en: z.string().min(1).max(280),
  fr: z.string().min(1).max(320),
  severity: NoticeSeverity,
});

/** Coordinator broadcasts a bilingual notice signed by the city. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`notices:${clientKey(req)}`, 10, 30)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "English and French text are both required" }, { status: 400 });
  }
  try {
    const ev = await publishNotice(parsed.data);
    return Response.json({ ok: true, eventId: ev.id });
  } catch (err) {
    const { status, reason } = noticePublishHttpError(err);
    return Response.json({ ok: false, reason }, { status });
  }
}
