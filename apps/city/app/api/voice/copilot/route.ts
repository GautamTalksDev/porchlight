import { z } from "zod";
import { denyUnlessCoordinator, currentCoordinator } from "@/lib/auth";
import { allow, clientKey } from "@/lib/ratelimit";
import { agentSignedUrl, voiceConfigured } from "@/lib/voice";

export const runtime = "nodejs";

const FIRST_MESSAGE = "Porchlight here. What do you need?";
const Body = z.object({ probe: z.boolean().optional() }).optional();

/**
 * Starts a Hey Porchlight session for the coordinator. Returns a short-lived signed URL for the
 * copilot agent, or 503 when ElevenLabs and the copilot agent id are not configured.
 * Pass { probe: true } to check configuration without minting a signed URL.
 */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`voice-copilot:${clientKey(req)}`, 5, 0.2)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  if (!voiceConfigured().copilot) {
    return Response.json({ ok: false, reason: "The copilot agent is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (parsed.success && parsed.data?.probe) {
    return Response.json({ ok: true });
  }
  const coordinator = await currentCoordinator();
  try {
    const signedUrl = await agentSignedUrl(process.env.ELEVENLABS_COPILOT_AGENT_ID);
    return Response.json({
      signedUrl,
      firstMessage: FIRST_MESSAGE,
      dynamicVariables: { coordinator_name: coordinator?.name ?? "Coordinator" },
    });
  } catch (err) {
    console.error("[voice] copilot agent unavailable:", (err as Error).message);
    return Response.json({ ok: false, reason: "The copilot agent is not configured" }, { status: 503 });
  }
}
