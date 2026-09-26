import { authMode } from "@/lib/auth";
import { dbEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public health check. Reports which integrations are switched on, never their secrets. */
export async function GET() {
  return Response.json({
    ok: true,
    auth: authMode(),
    storage: dbEnabled() ? "tiger-data" : "memory",
    gemini: Boolean(process.env.GEMINI_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  });
}
