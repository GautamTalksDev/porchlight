import { authMode, denyUnlessCoordinator } from "@/lib/auth";
import { auth0Configured } from "@/lib/auth0";
import { city } from "@/lib/city";
import { dbEnabled, pool } from "@/lib/db";
import { geminiQuotaPreflightDetail, resolveGeminiModels } from "@/lib/gemini";
import type { PreflightCheck } from "@/lib/preflight";
import { summarizePreflight } from "@/lib/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkDatabase(): Promise<PreflightCheck> {
  if (!dbEnabled()) {
    return { name: "database", ok: true, detail: "memory mode" };
  }
  try {
    await Promise.race([
      pool().query("SELECT 1"),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2_000)),
    ]);
    return { name: "database", ok: true, detail: "Tiger Data reachable" };
  } catch (err) {
    const msg = (err as Error).message === "timeout" ? "timed out after 2 seconds" : (err as Error).message;
    return { name: "database", ok: false, detail: msg };
  }
}

/** Coordinator-only readiness list before a rehearsal. No paid API calls. */
export async function GET() {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;

  await city().ready;
  const c = city();
  const now = Date.now();

  const checks: PreflightCheck[] = [];
  checks.push(await checkDatabase());

  const geminiKey = Boolean(process.env.GEMINI_API_KEY);
  const models = resolveGeminiModels();
  checks.push({
    name: "Gemini",
    ok: geminiKey,
    detail: geminiKey ? `key present; models ${models.join(", ")}` : "GEMINI_API_KEY is not set",
  });

  const quota = geminiQuotaPreflightDetail(now);
  checks.push({
    name: "Gemini quota",
    ok: quota.ok,
    detail: quota.detail,
  });

  const elKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const voiceAgent = Boolean(process.env.ELEVENLABS_AGENT_ID);
  const copilotAgent = Boolean(process.env.ELEVENLABS_COPILOT_AGENT_ID);
  checks.push({
    name: "ElevenLabs",
    ok: elKey && voiceAgent && copilotAgent,
    detail: elKey && voiceAgent && copilotAgent
      ? "key and both agent ids present"
      : `key ${elKey ? "ok" : "missing"}, voice agent ${voiceAgent ? "ok" : "missing"}, copilot agent ${copilotAgent ? "ok" : "missing"}`,
  });

  checks.push({
    name: "Auth0",
    ok: auth0Configured || authMode() === "local-open",
    detail: auth0Configured ? "configured" : authMode() === "local-open" ? "local development (sign-in open)" : "not configured",
  });

  const fresh = [...c.nodes.values()].filter((n) => now - n.lastSeenAt < 15_000);
  checks.push({
    name: "nodes",
    ok: fresh.length > 0,
    detail: fresh.length === 1 ? "1 reported in the last 15 seconds" : `${fresh.length} reported in the last 15 seconds`,
  });

  const lastSeen = [...c.nodes.values()].reduce((best, n) => Math.max(best, n.lastSeenAt), 0);
  if (!lastSeen) {
    checks.push({ name: "last delivery", ok: false, detail: "never" });
  } else {
    const agoSec = Math.max(0, Math.round((now - lastSeen) / 1000));
    checks.push({
      name: "last delivery",
      ok: agoSec < 60,
      detail: agoSec < 5 ? "just now" : `${agoSec} s ago`,
    });
  }

  const outage = c.outage;
  const emergency = c.emergencySince != null;
  checks.push({
    name: "emergency and outage",
    ok: !outage && !emergency,
    detail: !outage && !emergency
      ? "no outage, no emergency"
      : [outage ? "outage simulated" : null, emergency ? "emergency active" : null].filter(Boolean).join(", "),
  });

  const summary = summarizePreflight(checks);
  return Response.json({ ok: summary.ok, summary, checks });
}
