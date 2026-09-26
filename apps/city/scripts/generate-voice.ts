import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Records every voice clip Porchlight plays while offline, so neighbourhood nodes can speak with no
 * internet at all. Uses ElevenLabs v3 with expressive audio tags for a calm, human delivery, and falls
 * back to Multilingual v2 if v3 is not available on your plan.
 *
 * Usage: npm run voice:generate   (needs ELEVENLABS_API_KEY in .env)
 */
const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(join(here, "..", "..", "..", ".env"));
} catch {
  /* use the shell environment */
}
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set. Add it to .env first.");
  process.exit(1);
}
const client = new ElevenLabsClient({ apiKey });
const voice = { en: process.env.ELEVENLABS_VOICE_ID_EN || "JBFqnCBsd6RMkjVDRZzb", fr: process.env.ELEVENLABS_VOICE_ID_FR || process.env.ELEVENLABS_VOICE_ID_EN || "JBFqnCBsd6RMkjVDRZzb" };

const NODE_AUDIO = join(here, "..", "..", "node", "public", "audio");
const CITY_AUDIO = join(here, "..", "public", "audio", "present");

const clips: { dir: string; name: string; lang: "en" | "fr"; text: string }[] = [
  { dir: join(NODE_AUDIO, "en"), name: "help-received", lang: "en", text: "[calm] Your call for help was received. Your neighbours have been notified." },
  { dir: join(NODE_AUDIO, "fr"), name: "help-received", lang: "fr", text: "[calm] Votre appel à l'aide a été reçu. Vos voisins ont été prévenus." },
  { dir: join(NODE_AUDIO, "en"), name: "ok-received", lang: "en", text: "[warmly] Thank you. You're marked as safe." },
  { dir: join(NODE_AUDIO, "fr"), name: "ok-received", lang: "fr", text: "[warmly] Merci. Vous êtes indiqué comme étant en sécurité." },
  { dir: join(NODE_AUDIO, "en"), name: "neighbour-alert", lang: "en", text: "[urgent but steady] A neighbour needs help. Check the screen for the address." },
  { dir: join(NODE_AUDIO, "fr"), name: "neighbour-alert", lang: "fr", text: "[urgent but steady] Un voisin a besoin d'aide. Consultez l'écran pour l'adresse." },
  { dir: join(NODE_AUDIO, "en"), name: "help-coming", lang: "en", text: "[reassuring] A neighbour is on the way." },
  { dir: join(NODE_AUDIO, "fr"), name: "help-coming", lang: "fr", text: "[reassuring] Un voisin est en route." },
  { dir: CITY_AUDIO, name: "checkin-fr", lang: "fr", text: "[calm] Bonjour, ici Porchlight pour la Ville. Nous avons reçu votre appel à l'aide. Êtes-vous en sécurité en ce moment?" },
  { dir: CITY_AUDIO, name: "checkin-en", lang: "en", text: "[calm] Hello, this is Porchlight calling for the city. We received your call for help. Are you safe right now?" },
];

async function render(text: string, lang: "en" | "fr"): Promise<Buffer> {
  const attempt = async (modelId: string, body: string) => {
    const stream = await client.textToSpeech.convert(voice[lang], { text: body, modelId, languageCode: lang, outputFormat: "mp3_44100_128" });
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  };
  try {
    return await attempt("eleven_v3", text);
  } catch (err) {
    console.warn(`  v3 unavailable (${(err as Error).message}), using Multilingual v2`);
    return attempt("eleven_multilingual_v2", text.replace(/\[[^\]]*\]\s*/g, ""));
  }
}

for (const c of clips) {
  mkdirSync(c.dir, { recursive: true });
  process.stdout.write(`${c.lang} ${c.name} ... `);
  const audio = await render(c.text, c.lang);
  writeFileSync(join(c.dir, `${c.name}.mp3`), audio);
  console.log(`${Math.round(audio.length / 1024)} KB`);
}
console.log("\nDone. The node console and story mode will now use these recordings, even offline.");
