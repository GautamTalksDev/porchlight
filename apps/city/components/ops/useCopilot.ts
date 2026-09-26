"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { buildOverview, resolveHousehold } from "@/lib/copilot";
import type { CitySnapshot } from "@/lib/city";
import type { TriageResult } from "@/lib/triage";

export interface CopilotLine {
  who: "agent" | "user" | "tool";
  text: string;
}

export interface CopilotLive {
  snap: CitySnapshot | null;
  triage: TriageResult | null;
  counts: { help: number; acknowledged: number; ok: number; unknown: number };
  nodesReporting: number;
  nodesTotal: number;
}

type Conv = { endSession: () => Promise<void> };

type DisconnectDetails =
  | { reason: "error"; message: string; closeReason?: string }
  | { reason: "agent"; closeReason?: string }
  | { reason: "user" };

type SessionPayload = {
  signedUrl: string;
  firstMessage: string;
  dynamicVariables: Record<string, string | number>;
};

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const UNKNOWN = "I could not find that address on this street.";

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
 * Hey Porchlight: a coordinator voice copilot. The Conversation lives in a ref and is only ended
 * on End, a start_check_in handoff, or page unmount. OpsRoom re-renders must never tear it down.
 */
export function useCopilot(opts: {
  liveRef: MutableRefObject<CopilotLive>;
  onSelect: (householdId: string | null) => void;
  onFocus: (target: string) => void;
  onStartCheckIn: (householdId: string, incidentKey: string | null) => void;
  onToolUsed: () => void;
}) {
  const [lines, setLines] = useState<CopilotLine[]>([]);
  const [state, setState] = useState<"idle" | "connecting" | "speaking" | "listening" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const conv = useRef<Conv | null>(null);
  const intentionalEnd = useRef(false);
  const starting = useRef(false);
  const retriedWithoutOverrides = useRef(false);
  const sessionPayload = useRef<SessionPayload | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const addLine = useCallback((l: CopilotLine) => {
    setLines((prev) => [...prev.slice(-40), l]);
  }, []);

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
    sessionPayload.current = null;
    retriedWithoutOverrides.current = false;
    setError(null);
    setState("idle");
  }, [closeSession]);

  const endRef = useRef(end);
  endRef.current = end;

  // Tear down only when the page unmounts, never when OpsRoom re-renders every second.
  useEffect(() => {
    return () => {
      intentionalEnd.current = true;
      const c = conv.current;
      conv.current = null;
      void c?.endSession().catch(() => undefined);
    };
  }, []);

  const openConversation = useCallback(
    async (payload: SessionPayload, useOverrides: boolean): Promise<Conv> => {
      const { Conversation } = await import("@elevenlabs/client");
      intentionalEnd.current = false;

      const tool = (label: string, reply: string) => {
        addLine({ who: "tool", text: `${label}: ${reply}` });
        optsRef.current.onToolUsed();
        return reply;
      };

      const households = () =>
        (optsRef.current.liveRef.current.snap?.households ?? []).map((h) => ({ id: h.id, label: h.label }));
      const find = (address: string | undefined) => {
        if (!address?.trim()) return null;
        return resolveHousehold(address, households());
      };

      const session = await Conversation.startSession({
        signedUrl: payload.signedUrl,
        connectionType: "websocket",
        dynamicVariables: payload.dynamicVariables,
        ...(useOverrides ? { overrides: { agent: { firstMessage: payload.firstMessage } } } : {}),
        clientTools: {
          get_overview: async () => {
            const live = optsRef.current.liveRef.current;
            const text = buildOverview({
              counts: live.counts,
              queue: (live.triage?.items ?? []).map((i) => ({
                label: i.label,
                needs: i.needs,
                noNeighbour: i.tier === "city",
              })),
              silent: (live.snap?.silent ?? []).map((h) => ({
                label: h.label,
                minutesSilent: h.minutesSilent,
              })),
              outage: Boolean(live.snap?.outage),
              emergencySince: live.snap?.emergencySince ?? null,
              nodesReporting: live.nodesReporting,
              nodesTotal: live.nodesTotal,
            });
            return tool("Overview", text);
          },
          get_household: async (p: { address?: string }) => {
            const hit = find(p?.address);
            if (!hit) return tool(`Look up ${p?.address ?? "address"}`, UNKNOWN);
            const live = optsRef.current.liveRef.current;
            const h = live.snap?.households.find((x) => x.id === hit.id);
            if (!h) return tool(`Look up ${hit.label}`, UNKNOWN);
            const statusWords: Record<string, string> = {
              unknown: "not heard from",
              ok: "safe",
              help: "needs help",
              acknowledged: "help on the way",
            };
            const needs = h.needs.map((n) => n.label).join(", ") || "no recorded needs";
            const lang = h.lang === "fr" ? "French" : "English";
            const silent = live.snap?.silent?.find((x) => x.household === hit.id);
            const open = live.snap?.incidents.find((i) => i.household === hit.id && i.status !== "resolved");
            let wait = "";
            if (open) wait = ` Waiting ${open.waitMinutes} minutes.`;
            else if (silent) wait = ` Silent for ${silent.minutesSilent} minutes.`;
            let circles = "";
            if (open) {
              const tierWords: Record<string, string> = {
                buddies: "buddies alerted",
                street: "street alerted",
                city: "no neighbour has answered yet",
              };
              if (open.tier) circles += ` Escalation: ${tierWords[open.tier] ?? open.tier}.`;
              if (open.buddies?.length) {
                circles += ` Buddies: ${open.buddies.map((b) => b.label).join(", ")}.`;
              }
              const latest = (open.neighbourThread ?? []).slice(-2);
              if (latest.length) {
                circles += ` Latest replies: ${latest.map((r) => `${r.actorLabel} said ${r.replyLabel}`).join("; ")}.`;
              } else {
                circles += " No neighbour replies yet.";
              }
            }
            const trail = live.snap?.trail[hit.id]?.[0];
            let how = "";
            if (trail) {
              how = trail.via
                ? ` Latest event signed by ${trail.by}, relayed by ${trail.via}.`
                : ` Latest event signed by ${trail.by}.`;
            }
            const reply = `${hit.label} is ${statusWords[h.status] ?? h.status}. Speaks ${lang}. Needs: ${needs}.${wait}${circles}${how}`;
            return tool(`Look up ${hit.label}`, reply);
          },
          dispatch: async (p: { address?: string }) => {
            const hit = find(p?.address);
            if (!hit) return tool(`Dispatch ${p?.address ?? "address"}`, UNKNOWN);
            const r = await post("/api/actions", { kind: "ack", household: hit.id });
            if (!r.ok) {
              return tool(`Dispatch ${hit.label}`, "That dispatch did not go through. Try again from the panel.");
            }
            const data = await r.json();
            optsRef.current.onSelect(hit.id);
            if (data.already) {
              return tool(`Dispatch ${hit.label}`, `Help is already on the way to ${hit.label}.`);
            }
            return tool(`Dispatch ${hit.label}`, `Someone is on the way to ${hit.label}.`);
          },
          mark_safe: async (p: { address?: string }) => {
            const hit = find(p?.address);
            if (!hit) return tool(`Mark safe ${p?.address ?? "address"}`, UNKNOWN);
            const r = await post("/api/actions", { kind: "ok", household: hit.id });
            if (!r.ok) {
              return tool(`Mark safe ${hit.label}`, "Could not mark that home safe. Try again from the panel.");
            }
            optsRef.current.onSelect(hit.id);
            return tool(`Mark safe ${hit.label}`, `${hit.label} is marked safe.`);
          },
          show_on_map: async (p: { address?: string }) => {
            const raw = (p?.address ?? "").trim().toLowerCase();
            if (raw === "overview" || raw === "ops" || raw === "street") {
              optsRef.current.onSelect(null);
              optsRef.current.onFocus("ops");
              return tool("Show overview", "Showing the street overview.");
            }
            const hit = find(p?.address);
            if (!hit) return tool(`Show ${p?.address ?? "address"}`, UNKNOWN);
            optsRef.current.onSelect(hit.id);
            optsRef.current.onFocus(hit.id);
            return tool(`Show ${hit.label}`, `Looking at ${hit.label}.`);
          },
          start_check_in: async (p: { address?: string }) => {
            const hit = find(p?.address);
            if (!hit) return tool(`Check in ${p?.address ?? "address"}`, UNKNOWN);
            const live = optsRef.current.liveRef.current;
            const open = live.snap?.incidents.find((i) => i.household === hit.id && i.status !== "resolved");
            const reply = "Starting the check-in call now.";
            addLine({ who: "tool", text: `Check in ${hit.label}: Starting the check-in call now.` });
            optsRef.current.onToolUsed();
            setTimeout(() => {
              void (async () => {
                await endRef.current();
                optsRef.current.onSelect(hit.id);
                optsRef.current.onStartCheckIn(hit.id, open?.key ?? null);
              })();
            }, 2200);
            return reply;
          },
          set_emergency: async (p: { active?: boolean }) => {
            const active = Boolean(p?.active);
            const r = await post("/api/emergency", { active });
            if (!r.ok) return tool("Emergency", "Could not update the emergency state.");
            return tool("Emergency", active ? "Emergency declared." : "Emergency ended.");
          },
          set_outage: async (p: { active?: boolean }) => {
            const active = Boolean(p?.active);
            const r = await post("/api/outage", { down: active });
            if (!r.ok) return tool("Outage", "Could not update the city link.");
            return tool("Outage", active ? "City outage simulated." : "City link restored.");
          },
        },
        onMessage: (m) =>
          addLine({
            who: String((m as { role?: string }).role ?? m.source) === "user" ? "user" : "agent",
            text: m.message,
          }),
        onModeChange: ({ mode }) => setState(mode === "speaking" ? "speaking" : "listening"),
        onDisconnect: (details: DisconnectDetails) => {
          const reason = disconnectReason(details);
          console.info("[copilot] disconnect:", reason, details);
          if (intentionalEnd.current) {
            setState("idle");
            return;
          }
          conv.current = null;
          if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(reason) && sessionPayload.current) {
            retriedWithoutOverrides.current = true;
            console.info("[copilot] retrying without overrides after:", reason);
            void openConversation(sessionPayload.current, false)
              .then((c) => {
                conv.current = c;
                setError(null);
                setState("listening");
              })
              .catch((err) => {
                console.info("[copilot] retry failed:", (err as Error).message);
                setError(`The assistant disconnected: ${reason}`);
                setState("error");
              });
            return;
          }
          setError(`The assistant disconnected: ${reason}`);
          setState("error");
        },
        onError: (message, context) => {
          console.info("[copilot] error:", message, context);
          const text = String(message);
          if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(text) && sessionPayload.current) {
            retriedWithoutOverrides.current = true;
            console.info("[copilot] retrying without overrides after error:", text);
            void (async () => {
              await closeSession(true);
              try {
                conv.current = await openConversation(sessionPayload.current!, false);
                setError(null);
                setState("listening");
              } catch (err) {
                setError(`The assistant disconnected: ${text}`);
                setState("error");
                console.info("[copilot] retry failed:", (err as Error).message);
              }
            })();
            return;
          }
          setError(text);
          setState("error");
        },
      });
      return session as Conv;
    },
    [addLine, closeSession],
  );

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    try {
      await closeSession(true);
      setLines([]);
      setError(null);
      setState("connecting");
      retriedWithoutOverrides.current = false;
      const res = await post("/api/voice/copilot", {});
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason = data.reason ?? "Could not start Porchlight";
        setState("error");
        setError(reason);
        if (res.status === 503) setAvailable(false);
        return;
      }
      setAvailable(true);
      const s = (await res.json()) as SessionPayload;
      sessionPayload.current = s;
      try {
        conv.current = await openConversation(s, true);
      } catch (err) {
        const msg = (err as Error).message;
        console.info("[copilot] error:", msg);
        if (!retriedWithoutOverrides.current && mentionsOverrideOrPermission(msg)) {
          retriedWithoutOverrides.current = true;
          console.info("[copilot] retrying without overrides after start failure");
          try {
            conv.current = await openConversation(s, false);
            return;
          } catch (err2) {
            setError(`Porchlight unavailable (${(err2 as Error).message}).`);
            setState("error");
            return;
          }
        }
        setError(`Porchlight unavailable (${msg}).`);
        setState("error");
      }
    } finally {
      starting.current = false;
    }
  }, [closeSession, openConversation]);

  const checkAvailable = useCallback(async () => {
    const res = await post("/api/voice/copilot", { probe: true });
    if (res.status === 503) {
      setAvailable(false);
      return false;
    }
    if (res.ok) setAvailable(true);
    return res.ok;
  }, []);

  return { lines, state, error, available, start, end, checkAvailable };
}
