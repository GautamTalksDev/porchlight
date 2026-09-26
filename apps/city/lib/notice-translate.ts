/**
 * Pure helpers for translating an English city notice into Canadian French via Gemini.
 */

export const NOTICE_TRANSLATE_SYSTEM = `You translate emergency notices for a city operations room into plain, formal Canadian French.
Keep every address, time, number, street name and proper noun unchanged.
Do not add advice, greetings or extra sentences. Return only the French text.`;

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
