"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
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

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const UNKNOWN = "I could not find that address on this street.";

/**
 * Hey Porchlight: a coordinator voice copilot. Tools always read the latest street state through
 * refs so replies stay fresh. Every tool call is shown in the transcript.
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
  const conv = useRef<{ endSession: () => Promise<void> } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const add = (l: CopilotLine) => setLines((prev) => [...prev.slice(-40), l]);

  const end = useCallback(async () => {
    try {
      await conv.current?.endSession();
    } catch {
      /* already closed */
    }
    conv.current = null;
    setState("idle");
  }, []);

  const households = () => {
    const snap = optsRef.current.liveRef.current.snap;
    return (snap?.households ?? []).map((h) => ({ id: h.id, label: h.label }));
  };

  const find = (address: string | undefined) => {
    if (!address?.trim()) return null;
    return resolveHousehold(address, households());
  };

  const start = useCallback(async () => {
    await end();
    setLines([]);
    setError(null);
    setState("connecting");
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
    const s = (await res.json()) as {
      signedUrl: string;
      firstMessage: string;
      dynamicVariables: Record<string, string | number>;
    };
    try {
      const { Conversation } = await import("@elevenlabs/client");
      const tool = (label: string, reply: string) => {
        add({ who: "tool", text: `${label}: ${reply}` });
        optsRef.current.onToolUsed();
        return reply;
      };

      conv.current = await Conversation.startSession({
        signedUrl: s.signedUrl,
        connectionType: "websocket",
        dynamicVariables: s.dynamicVariables,
        overrides: { agent: { firstMessage: s.firstMessage } },
        clientTools: {
          get_overview: async () => {
            const live = optsRef.current.liveRef.current;
            const text = buildOverview({
              counts: live.counts,
              queue: (live.triage?.items ?? []).map((i) => ({ label: i.label, needs: i.needs })),
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
            const trail = live.snap?.trail[hit.id]?.[0];
            let how = "";
            if (trail) {
              how = trail.via
                ? ` Latest event signed by ${trail.by}, relayed by ${trail.via}.`
                : ` Latest event signed by ${trail.by}.`;
            }
            const reply = `${hit.label} is ${statusWords[h.status] ?? h.status}. Speaks ${lang}. Needs: ${needs}.${wait}${how}`;
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
            add({ who: "tool", text: `Check in ${hit.label}: Starting the check-in call now.` });
            optsRef.current.onToolUsed();
            // Give the agent a moment to speak the confirmation, then hand off to the resident call.
            setTimeout(() => {
              void (async () => {
                await end();
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
          add({
            who: String((m as { role?: string }).role ?? m.source) === "user" ? "user" : "agent",
            text: m.message,
          }),
        onModeChange: ({ mode }) => setState(mode === "speaking" ? "speaking" : "listening"),
        onDisconnect: () => setState("idle"),
        onError: (message) => {
          setError(String(message));
          setState("error");
        },
      });
    } catch (err) {
      setError(`Porchlight unavailable (${(err as Error).message}).`);
      setState("error");
    }
  }, [end]);

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
