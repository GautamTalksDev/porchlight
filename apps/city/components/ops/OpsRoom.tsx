"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CityCanvas from "@/components/city/CityCanvas";
import { Brand } from "@/components/ui/Brand";
import type { CitySnapshot, CityMessage } from "@/lib/city";
import type { PorchlightCity } from "@/lib/city/scene";
import type { TriageResult } from "@/lib/triage";
import { Timeline } from "./Timeline";
import { useVoiceCall } from "./useVoiceCall";

const STATUS_TEXT: Record<string, string> = { unknown: "Not heard from", ok: "Safe", help: "Needs help", acknowledged: "Help on the way" };
const ACTION_TEXT: Record<string, string> = { dispatch_neighbour: "Suggested: dispatch now", voice_check_in: "Suggested: call first", monitor: "Suggested: keep watching" };

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.reason ?? `Request failed (${r.status})`);
  return data;
}

function ago(ms: number | null): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export default function OpsRoom({ coordinator, authMode, nodeHouseIds }: { coordinator: string; authMode: string; nodeHouseIds: string[] }) {
  const [snap, setSnap] = useState<CitySnapshot | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const cityRef = useRef<PorchlightCity | null>(null);
  const snapRef = useRef<CitySnapshot | null>(null);
  snapRef.current = snap;

  // Live data
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("open", () => setConnected(true));
      es.addEventListener("snapshot", (e) => setSnap(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("message", (e) => animate(JSON.parse((e as MessageEvent).data) as CityMessage));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  /** Turn deliveries into light: relayed alerts hop between node homes, then fly to City Hall. */
  const animate = (m: CityMessage) => {
    const city = cityRef.current;
    const s = snapRef.current;
    if (!city || m.type !== "delivery") return;
    const houseOfNode = (name: string) => s?.nodeHouses[name] ?? null;
    const nameOfOrigin = new Map((s?.nodes ?? []).map((n) => [n.id, n.name]));
    const deliverHouse = houseOfNode(m.node.name);
    m.events.slice(0, 6).forEach((ev, i) => {
      setTimeout(() => {
        const originName = nameOfOrigin.get(ev.origin);
        const originHouse = originName ? houseOfNode(originName) : null;
        const color = ev.kind === "help" ? "#ff6a55" : ev.kind === "ack" ? "#9ec5ff" : "#f2b35e";
        if (deliverHouse) {
          if (originHouse && originHouse !== deliverHouse) city.pulse(originHouse, deliverHouse, color, () => city.uplink(deliverHouse, color));
          else city.uplink(deliverHouse, color);
        }
      }, i * 350);
    });
  };

  // City link state drives the lights: a simulated outage darkens the city.
  useEffect(() => {
    const city = cityRef.current;
    if (!city || !snap) return;
    city.setCityLink(!snap.outage);
    city.setBlackout(snap.outage ? 0.92 : 0, snap.outage ? 0.22 : 0.3);
  }, [snap?.outage, snap]);

  // Triage
  const openKey = useMemo(
    () => (snap ? snap.incidents.filter((i) => i.status !== "resolved").map((i) => `${i.key}:${i.status}`).join("|") : ""),
    [snap],
  );
  const refreshTriage = useCallback(async () => {
    try {
      setTriage(await post("/api/triage", {}));
    } catch (err) {
      setNotice((err as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!snap) return;
    const t = setTimeout(refreshTriage, 600);
    return () => clearTimeout(t);
  }, [openKey, refreshTriage, snap === null]);

  const voice = useVoiceCall(useCallback(() => void refreshTriage(), [refreshTriage]));

  // Selection
  const selectedId = selected ?? triage?.items[0]?.household ?? null;
  const household = snap?.households.find((h) => h.id === selectedId) ?? null;
  const incident = snap?.incidents.find((i) => i.household === selectedId && i.status !== "resolved") ?? null;
  const ranked = triage?.items.find((r) => r.household === selectedId) ?? null;

  useEffect(() => {
    cityRef.current?.select(selectedId);
  }, [selectedId, snap]);

  const act = async (kind: "ok" | "ack") => {
    if (!household) return;
    try {
      await post("/api/actions", { kind, household: household.id, incident: incident?.key });
      setNotice(kind === "ok" ? `${household.label} marked safe` : `Someone is on the way to ${household.label}`);
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  const toggleOutage = async () => {
    try {
      await post("/api/outage", { down: !snap?.outage });
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const cityHouseholds = useMemo(
    () => (snap?.households ?? []).map((h) => ({ id: h.id, label: h.label, status: h.status as "unknown" | "ok" | "help" | "acknowledged" })),
    [snap],
  );

  return (
    <>
      <header className="shell-bar">
        <Brand href="/" />
        <nav className="shell-nav" aria-label="Sections">
          <a className="btn btn-quiet btn-small" href="/ops" aria-current="page">Operations room</a>
          <a className="btn btn-quiet btn-small" href="/cgi">Utility case (CGI)</a>
          <a className="btn btn-quiet btn-small" href="/present">Story mode</a>
        </nav>
        <div className="shell-nav">
          <span className="link-pill" data-down={String(Boolean(snap?.outage))}>
            <span className="dot" aria-hidden="true" />
            <span>{snap?.outage ? "City link down: nodes are holding alerts" : "City link up"}</span>
            <button className="btn btn-quiet btn-small" type="button" onClick={toggleOutage}>
              {snap?.outage ? "End the outage" : "Simulate city outage"}
            </button>
          </span>
          <span className="shell-user">{coordinator}</span>
          {authMode === "auth0" ? <a className="btn btn-quiet btn-small" href="/auth/logout">Sign out</a> : null}
        </div>
      </header>
      {authMode === "local-open" ? <p className="banner">Sign-in is off because this is local development. In production this room requires Auth0.</p> : null}
      {!connected ? <p className="banner banner-warn">Reconnecting to the city server…</p> : null}

      <main className="ops">
        <section className="ops-queue" aria-labelledby="queue-h">
          <div>
            <h1 id="queue-h" className="section-title">Who needs help first</h1>
            <p className="triage-source">
              {triage?.source === "gemini"
                ? `Ranked by Gemini (${triage.model}). Suggestions only: you decide.`
                : triage?.note ?? "Ranked by the built-in rules."}
            </p>
          </div>
          {triage && triage.items.length ? (
            <ol className="queue-list">
              {triage.items.map((r) => (
                <li key={r.incident}>
                  <button
                    type="button"
                    className="call"
                    data-status={snap?.incidents.find((i) => i.key === r.incident)?.status ?? "open"}
                    aria-pressed={selectedId === r.household}
                    onClick={() => {
                      setSelected(r.household);
                      cityRef.current?.focus(r.household);
                    }}
                  >
                    <span className="call-top">
                      <span className="call-name">{r.label}</span>
                      <span className="call-rank">Priority {r.priority}</span>
                    </span>
                    <span className="call-reason">{r.reason}</span>
                    <span className="tags">
                      {r.needs.map((n) => (
                        <span key={n} className={`tag ${/power/.test(n) ? "tag-power" : ""}`}>{n}</span>
                      ))}
                    </span>
                    <span className="call-meta">
                      {ACTION_TEXT[r.action]}. Waiting {r.waitMinutes} min. Speaks {r.lang === "fr" ? "French" : "English"}.
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">No open calls for help. When a beacon is pressed anywhere in the neighbourhood, it appears here as soon as a node reaches the city.</p>
          )}
        </section>

        <section className="ops-city" aria-label="City view">
          {snap ? (
            <CityCanvas
              households={cityHouseholds}
              nodeHouseIds={nodeHouseIds}
              labels="active"
              onSelect={(id) => {
                setSelected(id);
                cityRef.current?.focus(id);
              }}
              onReady={(c) => {
                cityRef.current = c;
                c.setCityLink(!snap.outage);
                if (snap.outage) c.setBlackout(0.92, 10);
                c.focus("crescent", 0);
              }}
            />
          ) : null}
        </section>

        <aside className="ops-detail" aria-labelledby="detail-h">
          {household ? (
            <>
              <div className="detail-head">
                <h2 id="detail-h">{household.label}</h2>
                <p>
                  <span className="status-word" data-status={household.status}>{STATUS_TEXT[household.status]}</span>
                  {household.lastEventAt ? `, last heard ${ago(household.lastEventAt)}` : null}
                </p>
                {household.needs.length ? (
                  <div className="tags">
                    {household.needs.map((n) => (
                      <span key={n.id} className={`tag ${/power/.test(n.label) ? "tag-power" : ""}`}>{n.label}</span>
                    ))}
                  </div>
                ) : (
                  <p className="section-sub">No needs recorded.</p>
                )}
                {incident ? (
                  <p className="section-sub">
                    Heard by {incident.witnesses.length} {incident.witnesses.length === 1 ? "node" : "nodes"}, waiting {incident.waitMinutes} min.
                    {incident.note ? ` Note from the home: “${incident.note}”` : ""}
                  </p>
                ) : null}
                {ranked ? <p>{ranked.reason}</p> : null}
              </div>
              <div className="actions">
                <button className="btn btn-porch" type="button" onClick={() => voice.start(household.id, incident?.key ?? null)} disabled={voice.state === "connecting"}>
                  {voice.state === "idle" || voice.state === "error" ? `Call in ${household.lang === "fr" ? "French" : "English"}` : "Calling…"}
                </button>
                <button className="btn btn-moon" type="button" onClick={() => act("ack")} disabled={!incident || incident.status !== "open"}>Dispatch a neighbour</button>
                <button className="btn btn-quiet" type="button" onClick={() => act("ok")}>Mark safe</button>
              </div>
              <section className="voice" aria-labelledby="voice-h">
                <h3 id="voice-h" className="section-title">Voice check-in</h3>
                <p className="voice-state" data-live={String(["speaking", "listening", "playing"].includes(voice.state))}>
                  {{ idle: "No call in progress.", connecting: "Connecting…", speaking: "Agent is speaking", listening: "Listening to the resident", playing: "Playing the opening line", error: voice.error ?? "The call failed." }[voice.state]}
                </p>
                {voice.error && voice.state !== "error" ? <p className="section-sub">{voice.error}</p> : null}
                <ol className="transcript" aria-live="polite">
                  {voice.lines.map((l, i) => (
                    <li key={i} className="line" data-who={l.who}>{l.text}</li>
                  ))}
                </ol>
                {voice.state !== "idle" && voice.state !== "error" ? (
                  <button className="btn btn-quiet btn-small" type="button" onClick={voice.end}>End call</button>
                ) : null}
              </section>
            </>
          ) : (
            <p className="empty" id="detail-h">Select a home in the city or in the list to see who lives there and what they need.</p>
          )}
        </aside>

        <section className="ops-strip" aria-label="Network health">
          <Timeline buckets={snap?.timeline.buckets ?? []} source={snap?.timeline.source ?? "memory"} />
          <div>
            <p className="section-title">Held offline</p>
            <dl className="kv">
              <dt>Typical wait</dt>
              <dd>{snap ? `${snap.holdSeconds.p50} s` : "…"}</dd>
              <dt>Slowest 5%</dt>
              <dd>{snap ? `${snap.holdSeconds.p95} s` : "…"}</dd>
              <dt>Events stored</dt>
              <dd>{snap ? `${snap.counts.events} in ${snap.storage === "tiger-data" ? "Tiger Data" : "memory"}` : "…"}</dd>
            </dl>
          </div>
          <div>
            <p className="section-title">Nodes</p>
            <ul>
              {(snap?.nodes ?? []).length ? (
                snap!.nodes.map((n) => (
                  <li key={n.id} className="node-row" data-fresh={String(Date.now() - n.lastSeenAt < 15_000)}>
                    <span>{n.name}</span>
                    <span>{n.delivered} delivered, {ago(n.lastSeenAt)}</span>
                  </li>
                ))
              ) : (
                <li className="section-sub">No node has reached the city yet.</li>
              )}
            </ul>
          </div>
        </section>
      </main>
      <div role="status" aria-live="polite" className="visually-hidden">{notice}</div>
      {notice ? <p className="banner" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", borderRadius: 999 }}>{notice}</p> : null}
    </>
  );
}
