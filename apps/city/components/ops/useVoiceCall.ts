"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Line {
  who: "agent" | "user" | "tool";
  text: string;
}

type Session =
  | { mode: "agent"; signedUrl: string; lang: "en" | "fr"; firstMessage: string; dynamicVariables: Record<string, string | number> }
  | { mode: "tts" | "speech"; lang: "en" | "fr"; firstMessage: string };

type Conv = { endSession: () => Promise<void> };

type DisconnectDetails =
  | { reason: "error"; message: string; closeReason?: string }
  | { reason: "agent"; closeReason?: string }
  | { reason: "user" };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function disconnectReason(details: DisconnectDetails): string {
  if (details.reason === "error") return details.message || details.closeReason || "error";
  if (details.reason === "agent") return details.closeReason || "agent ended the session";
  return "ended by user";
}

function mentionsOverrideOrPermission(reason: string): boolean {
  const r = reason.toLowerCase();
  return r.includes("override") || r.includes("permission");
}

/**
 * Voice check-ins. With an ElevenLabs agent: a live two-way conversation in the household's language,
 * with client tools the agent can use (mark safe, request a responder). The Conversation lives in a
 * ref and is only ended on End or unmount. Unexpected disconnects keep the panel open with a reason.
 */
export function useVoiceCall(onToolUsed: () => void) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"idle" | "connecting" | "speaking" | "listening" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const conv = useRef<Conv | null>(null);
  const intentionalEnd = useRef(false);
  const starting = useRef(false);
  const retriedWithoutOverrides = useRef(false);
  const agentSession = useRef<Extract<Session, { mode: "agent" }> | null>(null);
  const onToolUsedRef = useRef(onToolUsed);
  onToolUsedRef.current = onToolUsed;
  const householdRef = useRef<{ household: string; incident: string | null }>({ household: "", incident: null });

  const add = useCallback((l: Line) => setLines((prev) => [...prev.slice(-40), l]), []);

  const closeSession = useCallback(async (intentional: boolean) => {
    intentionalEnd.current = intentional;
    const c = conv.current;
    conv.current = null;
    if (!c) return;
    try {
      await c.endSession();
    } catch {
      /* already closed */
    }
  }, []);

  const end = useCallback(async () => {
    await closeSession(true);
    agentSession.current = null;
    retriedWithoutOverrides.current = false;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setError(null);
    setState("idle");
  }, [closeSession]);

  useEffect(() => {
    return () => {
      intentionalEnd.current = true;
      const c = conv.current;
      conv.current = null;
      void c?.endSession().catch(() => undefined);
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  const openAgent = useCallback(
    async (s: Extract<Session, { mode: "agent" }>, useOverrides: boolean) => {
      const { Conversation } = await import("@elevenlabs/client");
      const { household, incident } = householdRef.current;
      intentionalEnd.current = false;
      return (await Conversation.startSession({
        signedUrl: s.signedUrl,
        connectionType: "websocket",
        dynamicVariables: s.dynamicVariables,
        ...(useOverrides ? { overrides: { agent: { language: s.lang, firstMessage: s.firstMessage } } } : {}),
        clientTools: {
          mark_safe: async (p: { note?: string }) => {
            const r = await post("/api/actions", { kind: "ok", household, note: p?.note?.slice(0, 200) });
            add({ who: "tool", text: r.ok ? "Agent marked this household safe" : "Agent tried to mark safe, the city refused" });
            onToolUsedRef.current();
            return r.ok ? "The household is now marked safe." : "That did not work. Tell the resident a coordinator will follow up.";
          },
          request_responder: async (p: { reason?: string }) => {
            const r = await post("/api/actions", {
              kind: "ack",
              household,
              incident: incident ?? undefined,
              note: p?.reason?.slice(0, 200),
            });
            if (r.ok) {
              const data = await r.json();
              if (data.already) {
                add({ who: "tool", text: "Agent asked for a responder: help was already on the way" });
                onToolUsedRef.current();
                return "Help is already on the way to this home.";
              }
              add({ who: "tool", text: `Agent requested a responder: ${p?.reason ?? "no reason given"}` });
              onToolUsedRef.current();
              return "A responder has been requested.";
            }
            add({ who: "tool", text: "Agent requested a responder, but the city could not record it" });
            onToolUsedRef.current();
            return "Something went wrong. Tell the resident a coordinator will follow up right away.";
          },
        },
        onMessage: (m) => add({ who: String((m as { role?: string }).role ?? m.source) === "user" ? "user" : "agent", text: m.message }),
        onModeChange: ({ mode }) => setState(mode === "speaking" ? "speaking" : "listening"),
        onDisconnect: (details: DisconnectDetails) => {
          const reason = disconnectReason(details);
          console.info("[voice] disconnect:", reason, details);
          if (intentionalEnd.current) {
            setState("idle");
            return;
          }
          conv.current = null;
          if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(reason) && agentSession.current) {
            retriedWithoutOverrides.current = true;
            console.info("[voice] retrying without overrides after:", reason);
            void openAgent(agentSession.current, false)
              .then((c) => {
                conv.current = c;
                setError(null);
                setState("listening");
              })
              .catch((err) => {
                console.info("[voice] retry failed:", (err as Error).message);
                setError(`The assistant disconnected: ${reason}`);
                setState("error");
              });
            return;
          }
          setError(`The assistant disconnected: ${reason}`);
          setState("error");
        },
        onError: (message, context) => {
          console.info("[voice] error:", message, context);
          const text = String(message);
          if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(text) && agentSession.current) {
            retriedWithoutOverrides.current = true;
            console.info("[voice] retrying without overrides after error:", text);
            void (async () => {
              await closeSession(true);
              try {
                conv.current = await openAgent(agentSession.current!, false);
                setError(null);
                setState("listening");
              } catch (err) {
                console.info("[voice] retry failed:", (err as Error).message);
                setError(`The assistant disconnected: ${text}`);
                setState("error");
              }
            })();
            return;
          }
          setError(text);
          setState("error");
        },
      })) as Conv;
    },
    [add, closeSession],
  );

  const start = useCallback(
    async (household: string, incident: string | null) => {
      if (starting.current) return;
      starting.current = true;
      householdRef.current = { household, incident };
      try {
        await closeSession(true);
        setLines([]);
        setError(null);
        setState("connecting");
        retriedWithoutOverrides.current = false;
        agentSession.current = null;
        const res = await post("/api/voice/session", { household });
        if (!res.ok) {
          setState("error");
          setError((await res.json().catch(() => ({})))?.reason ?? "Could not start the call");
          return;
        }
        const s = (await res.json()) as Session;
        if (s.mode === "agent") {
          agentSession.current = s;
          try {
            conv.current = await openAgent(s, true);
            return;
          } catch (err) {
            const msg = (err as Error).message;
            console.info("[voice] error:", msg);
            if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(msg)) {
              retriedWithoutOverrides.current = true;
              console.info("[voice] retrying without overrides after start failure");
              try {
                conv.current = await openAgent(s, false);
                return;
              } catch (err2) {
                setError(`Live agent unavailable (${(err2 as Error).message}). Speaking the opening line instead.`);
              }
            } else {
              setError(`Live agent unavailable (${msg}). Speaking the opening line instead.`);
            }
          }
        }
        add({ who: "agent", text: s.firstMessage });
        setState("playing");
        if (s.mode === "tts" || s.mode === "agent") {
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
      } finally {
        starting.current = false;
      }
    },
    [add, closeSession, openAgent],
  );

  return { lines, state, error, start, end };
}
