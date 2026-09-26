import { z } from "zod";
import { denyUnlessCoordinator } from "@/lib/auth";
import { allow, clientKey } from "@/lib/ratelimit";
import { speak, voiceConfigured } from "@/lib/voice";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!voiceConfigured().tts) return Response.json({ ok: false, reason: "ElevenLabs is not configured" }, { status: 503 });
  if (!allow(`speak:${clientKey(req)}`, 10, 0.5)) return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  const parsed = z.object({ text: z.string().min(1).max(400), lang: z.enum(["en", "fr"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid text" }, { status: 400 });
  try {
    const audio = await speak(parsed.data.text, parsed.data.lang);
    return new Response(new Uint8Array(audio), { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" } });
  } catch (err) {
    console.error("[voice] tts failed:", (err as Error).message);
    return Response.json({ ok: false, reason: "voice service unavailable" }, { status: 502 });
  }
}
