import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * CGI's rule: none of their data may go into an AI tool. This test makes that a property of the code,
 * not a promise. Any AI SDK import, any network call, or any reference to our AI routes inside the CGI
 * module fails the build.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CGI_PATHS = ["lib/cgi", "components/cgi", "app/cgi"];
const FORBIDDEN: [RegExp, string][] = [
  [/@google\/genai|@google\/generative-ai/, "Gemini SDK"],
  [/@elevenlabs\//, "ElevenLabs SDK"],
  [/\bopenai\b|@anthropic-ai|langchain|@ai-sdk|\bollama\b/i, "AI SDK"],
  [/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource/, "network call"],
  [/\/api\/(triage|voice)/, "AI route"],
  [/from\s+["']@\/lib\/(triage|voice)/, "AI module import"],
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("AI firewall around the CGI module", () => {
  const all = CGI_PATHS.flatMap((p) => files(join(root, p)));

  it("finds the CGI module files", () => {
    assert.ok(all.length >= 4, `expected CGI files, found ${all.length}`);
  });

  for (const file of all) {
    it(`${file.slice(root.length + 1)} contains no AI and no network access`, () => {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      for (const [re, what] of FORBIDDEN) assert.equal(re.test(src), false, `${what} found in ${file}`);
    });
  }
});
