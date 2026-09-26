import { z } from "zod";
import { denyUnlessCoordinator } from "@/lib/auth";
import { city } from "@/lib/city";
import { NEED_LABELS, registry } from "@/lib/registry";
import { allow, clientKey } from "@/lib/ratelimit";
import { agentSignedUrl, voiceConfigured } from "@/lib/voice";
import { project, decodeHlc } from "@porchlight/protocol";

export const runtime = "nodejs";

/**
 * Starts a voice check-in. With an ElevenLabs agent configured the browser gets a short-lived signed
 * URL plus dynamic variables (address, language, needs, wait). Otherwise it gets a script to speak.
 */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`voice:${clientKey(req)}`, 5, 0.2)) return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  const parsed = z.object({ household: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid household" }, { status: 400 });
  const h = registry().households[parsed.data.household];
  if (!h) return Response.json({ ok: false, reason: "unknown household" }, { status: 404 });
  await city().ready;
  const inc = project(city().store.all()).incidents.find((i) => i.household === parsed.data.household && i.status !== "resolved");
  const waitMinutes = inc ? Math.max(0, Math.round((Date.now() - decodeHlc(inc.openedAt).wall) / 60000)) : 0;
  const firstMessage =
    h.lang === "fr"
      ? "Bonjour, ici Porchlight pour la Ville. Nous avons reçu votre appel à l'aide. Êtes-vous en sécurité en ce moment?"
      : "Hello, this is Porchlight calling for the city. We received your call for help. Are you safe right now?";
  const dynamicVariables = {
    household_id: parsed.data.household,
    household_label: h.label,
    language: h.lang === "fr" ? "French" : "English",
    needs: h.needs.map((n) => NEED_LABELS[n]?.en ?? n).join("; ") || "none recorded",
    wait_minutes: waitMinutes,
    incident_key: inc?.key ?? "none",
  };
  const v = voiceConfigured();
  if (v.agent) {
    try {
      return Response.json({ mode: "agent", signedUrl: await agentSignedUrl(), lang: h.lang, firstMessage, dynamicVariables });
    } catch (err) {
      console.error("[voice] agent unavailable:", (err as Error).message);
    }
  }
  return Response.json({ mode: v.tts ? "tts" : "speech", lang: h.lang, firstMessage, dynamicVariables });
}
