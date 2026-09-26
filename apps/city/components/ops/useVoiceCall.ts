"use client";

import { useCallback, useRef, useState } from "react";

export interface Line {
  who: "agent" | "user" | "tool";
  text: string;
}

type Session =
  | { mode: "agent"; signedUrl: string; lang: "en" | "fr"; firstMessage: string; dynamicVariables: Record<string, string | number> }
  | { mode: "tts" | "speech"; lang: "en" | "fr"; firstMessage: string };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * Voice check-ins. With an ElevenLabs agent: a live two-way conversation in the household's language,
 * with client tools the agent can use (mark safe, request a responder). Every tool call is shown in the
 * transcript and becomes a signed event, so a coordinator can audit what the agent did.
 * Without an agent: the opening line is spoken with ElevenLabs text to speech, or the browser voice.
 */
export function useVoiceCall(onToolUsed: () => void) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"idle" | "connecting" | "speaking" | "listening" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const conv = useRef<{ endSession: () => Promise<void> } | null>(null);

  const add = (l: Line) => setLines((prev) => [...prev.slice(-40), l]);

  const end = useCallback(async () => {
    try {
      await conv.current?.endSession();
    } catch {
      /* already closed */
    }
    conv.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("idle");
  }, []);

  const start = useCallback(
    async (household: string, incident: string | null) => {
      await end();
      setLines([]);
      setError(null);
      setState("connecting");
      const res = await post("/api/voice/session", { household });
      if (!res.ok) {
        setState("error");
        setError((await res.json().catch(() => ({})))?.reason ?? "Could not start the call");
        return;
      }
      const s = (await res.json()) as Session;
      if (s.mode === "agent") {
        try {
          const { Conversation } = await import("@elevenlabs/client");
          conv.current = await Conversation.startSession({
            signedUrl: s.signedUrl,
            connectionType: "websocket",
            dynamicVariables: s.dynamicVariables,
            overrides: { agent: { language: s.lang, firstMessage: s.firstMessage } },
            clientTools: {
              mark_safe: async (p: { note?: string }) => {
                const r = await post("/api/actions", { kind: "ok", household, note: p?.note?.slice(0, 200) });
                add({ who: "tool", text: r.ok ? "Agent marked this household safe" : "Agent tried to mark safe, the city refused" });
                onToolUsed();
                return r.ok ? "The household is now marked safe." : "That did not work. Tell the resident a coordinator will follow up.";
              },
              request_responder: async (p: { reason?: string }) => {
                const r = await post("/api/actions", { kind: "ack", household, incident: incident ?? undefined, note: p?.reason?.slice(0, 200) });
                add({ who: "tool", text: r.ok ? `Agent requested a responder: ${p?.reason ?? "no reason given"}` : "Agent requested a responder, the city refused" });
                onToolUsed();
                return r.ok ? "A responder has been requested." : "No open call to attach a responder to.";
              },
            },
            onMessage: (m) => add({ who: String((m as { role?: string }).role ?? m.source) === "user" ? "user" : "agent", text: m.message }),
            onModeChange: ({ mode }) => setState(mode === "speaking" ? "speaking" : "listening"),
            onDisconnect: () => setState("idle"),
            onError: (message) => {
              setError(String(message));
              setState("error");
            },
          });
          return;
        } catch (err) {
          setError(`Live agent unavailable (${(err as Error).message}). Speaking the opening line instead.`);
        }
      }
      add({ who: "agent", text: s.firstMessage });
      setState("playing");
      if (s.mode === "tts") {
        const audio = await post("/api/voice/speak", { text: s.firstMessage, lang: s.lang });
        if (audio.ok) {
          const url = URL.createObjectURL(await audio.blob());
          const el = new Audio(url);
          el.onended = () => {
            URL.revokeObjectURL(url);
            setState("idle");
          };
          await el.play().catch(() => setState("idle"));
          return;
        }
      }
      const u = new SpeechSynthesisUtterance(s.firstMessage);
      u.lang = s.lang === "fr" ? "fr-CA" : "en-CA";
      u.onend = () => setState("idle");
      window.speechSynthesis.speak(u);
    },
    [end, onToolUsed],
  );

  return { lines, state, error, start, end };
}
