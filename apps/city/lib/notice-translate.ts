/**
 * Pure helpers for translating an English city notice into Canadian French via Gemini.
 */

import { z } from "zod";

export const NOTICE_TRANSLATE_SYSTEM = `You translate emergency notices for a city operations room into plain, formal Canadian French.
Keep every address, time, number, street name and proper noun unchanged.
Do not add advice, greetings or extra sentences. Return only the French text.`;

const NoticeTranslateBody = z.object({
  en: z.string().trim().min(1).max(280),
});

/** Validate the translate API body. Missing or blank English is a client error, not a Gemini failure. */
export function parseNoticeTranslateBody(
  raw: unknown,
): { ok: true; en: string } | { ok: false; status: 400; reason: string } {
  const parsed = NoticeTranslateBody.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, reason: "English text is required" };
  }
  return { ok: true, en: parsed.data.en };
}

/**
 * Run body validation, then the translator. Used by the route and by tests so a valid
 * English payload always reaches the translator and a missing one never does.
 */
export async function runNoticeTranslate(
  raw: unknown,
  translate: (en: string) => Promise<{ fr: string; model: string }>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseNoticeTranslateBody(raw);
  if (!parsed.ok) {
    return { status: parsed.status, body: { ok: false, reason: parsed.reason } };
  }
  const result = await translate(parsed.en);
  return { status: 200, body: result };
}

/** Build the user prompt Gemini sees. The English text is untrusted street/coordinator input. */
export function buildNoticeTranslatePrompt(en: string): string {
  return `Translate this English notice into plain, formal Canadian French. Keep addresses, times and numbers unchanged.\n\n${en}`;
}

/**
 * Parse a model response into French text. Rejects empty or oversized strings.
 * Max length matches the protocol notice French limit (320).
 */
export function parseNoticeTranslateResponse(raw: string | null | undefined, maxLen = 320): string {
  const text = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text) throw new Error("empty translation");
  if (text.length > maxLen) throw new Error("translation too long");
  return text;
}

/** Same failure categories as triage, with wording that tells the coordinator to type French by hand. */
export function describeNoticeTranslateFailure(message: string): string {
  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(message)) {
    return "Gemini is busy right now. Type the French version to send.";
  }
  if (/took longer|timed? ?out|deadline/i.test(message)) {
    return "Gemini did not answer in time. Type the French version to send.";
  }
  if (/\b40[13]\b|api key|permission/i.test(message)) {
    return "Gemini rejected the API key. Type the French version to send.";
  }
  return "Gemini is unavailable. Type the French version to send.";
}
