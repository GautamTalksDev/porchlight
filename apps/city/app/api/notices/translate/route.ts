import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { denyUnlessCoordinator } from "@/lib/auth";
import { buildNoticeTranslatePrompt, NOTICE_TRANSLATE_SYSTEM, parseNoticeTranslateResponse } from "@/lib/notice-translate";
import { allow, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  en: z.string().min(1).max(280),
});

/** Ask Gemini for a Canadian French version of an English notice. No paid call when the key is missing. */
export async function POST(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  if (!allow(`notices-translate:${clientKey(req)}`, 10, 30)) {
    return Response.json({ ok: false, reason: "slow down" }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "English text is required" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, reason: "Gemini is not configured. Type the French text by hand." }, { status: 503 });
  }

  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.6-flash", process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash"])];
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildNoticeTranslatePrompt(parsed.data.en);
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
  return Response.json({ ok: false, reason: lastError }, { status: 503 });
}
