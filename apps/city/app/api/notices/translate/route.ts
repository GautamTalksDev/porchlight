import { GoogleGenAI } from "@google/genai";
import { denyUnlessCoordinator } from "@/lib/auth";
import {
  buildNoticeTranslatePrompt,
  describeNoticeTranslateFailure,
  NOTICE_TRANSLATE_SYSTEM,
  parseNoticeTranslateBody,
  parseNoticeTranslateResponse,
} from "@/lib/notice-translate";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, reason: string) {
  console.error(`[notices] translate failed: ${reason}`);
  return Response.json({ ok: false, reason }, { status });
}

/** Ask Gemini for a Canadian French version of an English notice. No paid call when the key is missing. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`notices-translate:${clientKey(req)}`, 10, 30)) {
    return fail(429, "slow down");
  }

  const parsed = parseNoticeTranslateBody(await req.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.status, parsed.reason);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fail(503, describeNoticeTranslateFailure("api key"));
  }

  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.6-flash", process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash"])];
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildNoticeTranslatePrompt(parsed.en);
  let lastError = "Gemini is unavailable";
  for (const model of models) {
    try {
      const call = ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: NOTICE_TRANSLATE_SYSTEM,
          temperature: 0.2,
        },
      });
      const response = await Promise.race([
        call,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Gemini took longer than 6 seconds")), 6_000)),
      ]);
      const fr = parseNoticeTranslateResponse(response.text);
      return Response.json({ fr, model });
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return fail(503, describeNoticeTranslateFailure(lastError));
}
