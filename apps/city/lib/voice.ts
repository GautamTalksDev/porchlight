import "server-only";
import { createHash } from "node:crypto";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/** Default voices are public ElevenLabs library voices; replace them with your own in .env. */
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

export function voiceConfigured() {
  return {
    tts: Boolean(process.env.ELEVENLABS_API_KEY),
    agent: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID),
  };
}

function client(): ElevenLabsClient {
  return new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
}

export function voiceFor(lang: "en" | "fr"): string {
  return (lang === "fr" ? process.env.ELEVENLABS_VOICE_ID_FR : process.env.ELEVENLABS_VOICE_ID_EN) || DEFAULT_VOICE;
}

/**
 * A signed URL lets the browser open a conversation with our private agent without ever seeing
 * the API key. It expires quickly and is only issued to signed-in coordinators.
 */
export async function agentSignedUrl(): Promise<string> {
  const res = await client().conversationalAi.conversations.getSignedUrl({ agentId: process.env.ELEVENLABS_AGENT_ID! });
  return res.signedUrl;
}

const g = globalThis as unknown as { __plTts?: Map<string, Buffer> };

/** Text to speech with Flash v2.5 for low latency. Cached so repeated announcements cost nothing. */
export async function speak(text: string, lang: "en" | "fr"): Promise<Buffer> {
  g.__plTts ??= new Map();
  const key = createHash("sha256").update(`${lang}:${text}`).digest("hex");
  const hit = g.__plTts.get(key);
  if (hit) return hit;
  const stream = await client().textToSpeech.convert(voiceFor(lang), {
    text,
    modelId: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
    languageCode: lang,
    outputFormat: "mp3_44100_128",
  });
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  if (g.__plTts.size > 200) g.__plTts.clear();
  g.__plTts.set(key, buf);
  return buf;
}
