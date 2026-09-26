"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CityCanvas from "@/components/city/CityCanvas";
import { Brand } from "@/components/ui/Brand";
import type { CityMessage, CitySnapshot } from "@/lib/city";
import type { PorchlightCity } from "@/lib/city/scene";
import type { TriageResult } from "@/lib/triage";
import { Timeline } from "./Timeline";
import { useVoiceCall } from "./useVoiceCall";

const STATUS_TEXT: Record<string, string> = { unknown: "Not heard from", ok: "Safe", help: "Needs help", acknowledged: "Help on the way" };
const ACTION_TEXT: Record<string, string> = { dispatch_neighbour: "Suggested: dispatch now", voice_check_in: "Suggested: call first", monitor: "Suggested: keep watching" };
const KIND_TEXT: Record<string, string> = { help: "Call for help", ok: "Marked safe", ack: "Help on the way", note: "Note" };

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

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Arrival {
  key: string;
  household: string;
  label: string;
}

export default function OpsRoom({ coordinator, authMode, nodeHouseIds }: { coordinator: string; authMode: string; nodeHouseIds: string[] }) {
  const [snap, setSnap] = useState<CitySnapshot | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(true);
  const cityRef = useRef<PorchlightCity | null>(null);
  const snapRef = useRef<CitySnapshot | null>(null);
  const known = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
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

  /** Deliveries become light: relayed calls hop between node homes, then fly to City Hall. */
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
        if (!deliverHouse) return;
        if (originHouse && originHouse !== deliverHouse) city.pulse(originHouse, deliverHouse, color, () => city.uplink(deliverHouse, color));
        else city.uplink(deliverHouse, color);
      }, i * 350);
    });
  };

  // Sound needs a user gesture first. Unlock it on the first click or key press.
  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      audio.current.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const chime = useCallback(() => {
    const ctx = audio.current;
    if (!sound || !ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    for (const [freq, at] of [[660, 0], [880, 0.16]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.16, t + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.7);
      o.connect(g).connect(ctx.destination);
      o.start(t + at);
      o.stop(t + at + 0.75);
    }
  }, [sound]);

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
    const t = setTimeout(refreshTriage, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, refreshTriage, snap === null]);

  const voice = useVoiceCall(useCallback(() => void refreshTriage(), [refreshTriage]));

  // The arrival moment: a new call for help gets a chime, a banner, and the camera.
  useEffect(() => {
    if (!snap) return;
    if (known.current === null) {
      known.current = new Set(snap.incidents.map((i) => i.key));
      return;
    }
    const arrived = snap.incidents.filter((i) => i.status === "open" && !known.current!.has(i.key));
    for (const i of snap.incidents) known.current.add(i.key);
    if (!arrived.length) return;
    const first = arrived[0]!;
    setArrival({ key: first.key, household: first.household, label: first.label });
    setFresh(new Set(arrived.map((a) => a.key)));
    chime();
    if (voice.state === "idle" || voice.state === "error") {
      setSelected(first.household);
      cityRef.current?.focus(first.household);
    }
    const t = setTimeout(() => setArrival(null), 7000);
    const f = setTimeout(() => setFresh(new Set()), 4000);
    return () => {
      clearTimeout(t);
      clearTimeout(f);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // Selection. An empty string means "nothing selected on purpose".
  const selectedId = selected === "" ? null : selected ?? triage?.items[0]?.household ?? null;
  const household = snap?.households.find((h) => h.id === selectedId) ?? null;
  const incident = snap?.incidents.find((i) => i.household === selectedId && i.status !== "resolved") ?? null;
  const ranked = triage?.items.find((r) => r.household === selectedId) ?? null;
  const trail = (selectedId && snap?.trail[selectedId]) || [];

  useEffect(() => {
    cityRef.current?.select(selectedId);
  }, [selectedId, snap]);

  const choose = useCallback((id: string) => {
    setSelected(id);
    cityRef.current?.focus(id);
  }, []);

  const act = useCallback(
    async (kind: "ok" | "ack") => {
      if (!household) return;
      try {
        await post("/api/actions", { kind, household: household.id, incident: incident?.key });
        setNotice(kind === "ok" ? `${household.label} marked safe` : `Someone is on the way to ${household.label}`);
      } catch (err) {
        setNotice((err as Error).message);
      }
    },
    [household, incident],
  );

  const toggleOutage = async () => {
    try {
      await post("/api/outage", { down: !snap?.outage });
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  // Keyboard shortcuts for a coordinator working fast: J and K move, C calls, D dispatches, S marks safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const items = triage?.items ?? [];
      const idx = items.findIndex((r) => r.household === selectedId);
      const key = e.key.toLowerCase();
      if (key === "j" && items.length) choose(items[Math.min(items.length - 1, idx + 1)]!.household);
      else if (key === "k" && items.length) choose(items[Math.max(0, idx - 1)]!.household);
      else if (key === "c" && household) void voice.start(household.id, incident?.key ?? null);
      else if (key === "d" && incident?.status === "open") void act("ack");
      else if (key === "s" && household) void act("ok");
      else if (key === "escape") {
        setSelected("");
        cityRef.current?.focus("ops");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triage, selectedId, household, incident, voice, act, choose]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const cityHouseholds = useMemo(
    () => (snap?.households ?? []).map((h) => ({ id: h.id, label: h.label, status: h.status as "unknown" | "ok" | "help" | "acknowledged" })),
    [snap],
  );

  const counts = useMemo(() => {
    const c = { help: 0, acknowledged: 0, ok: 0, unknown: 0 };
    for (const h of snap?.households ?? []) c[h.status as keyof typeof c] += 1;
    return c;
  }, [snap]);
  const nodesFresh = (snap?.nodes ?? []).filter((n) => Date.now() - n.lastSeenAt < 15_000).length;
  const nodesTotal = Math.max(snap?.nodes.length ?? 0, nodeHouseIds.length);

  return (
    <div className="ops-page">
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
            <span>{snap?.outage ? "City link down: nodes are holding calls" : "City link up"}</span>
            <button className="btn btn-quiet btn-small" type="button" onClick={toggleOutage}>
              {snap?.outage ? "End the outage" : "Simulate city outage"}
            </button>
          </span>
          <button className="btn btn-quiet btn-small" type="button" aria-pressed={sound} onClick={() => setSound((s) => !s)}>
            {sound ? "Sound on" : "Sound off"}
          </button>
          <span className="shell-user">{coordinator}</span>
          {authMode === "auth0" ? <a className="btn btn-quiet btn-small" href="/auth/logout">Sign out</a> : null}
        </div>
      </header>
      {authMode === "local-open" ? <p className="banner">Sign-in is off because this is local development. In production this room requires Auth0.</p> : null}
      {!connected ? <p className="banner banner-warn">Reconnecting to the city server…</p> : null}

      <main className="ops-stage">
        <section className="ops-city" aria-label="City view">
          {snap ? (
            <CityCanvas
              households={cityHouseholds}
              nodeHouseIds={nodeHouseIds}
              labels="active"
              onSelect={choose}
              onReady={(c) => {
                cityRef.current = c;
                c.setCityLink(!snap.outage);
                if (snap.outage) c.setBlackout(0.92, 10);
                c.focus("ops", 0);
              }}
            />
          ) : null}
        </section>

        <div className="ops-hud" role="status" aria-label="Street summary">
          <span className="hud-chip" data-kind="help"><strong>{counts.help}</strong>need help</span>
          <span className="hud-chip" data-kind="acknowledged"><strong>{counts.acknowledged}</strong>help on the way</span>
          <span className="hud-chip" data-kind="ok"><strong>{counts.ok}</strong>safe</span>
          <span className="hud-chip" data-kind="unknown"><strong>{counts.unknown}</strong>not heard from</span>
          <span className="hud-chip" data-kind="nodes"><strong>{nodesFresh}</strong>of {nodesTotal} nodes reporting</span>
        </div>

        {arrival ? (
          <button type="button" className="arrival" onClick={() => choose(arrival.household)}>
            <span className="arrival-dot" aria-hidden="true" />
            <span>
              <strong>New call for help</strong>
              <span>{arrival.label}. Press C to call, D to dispatch.</span>
            </span>
          </button>
        ) : null}

        <aside className="glass ops-left" aria-labelledby="queue-h">
          <div>
            <h1 id="queue-h" className="section-title">Who needs help first</h1>
            <p className="triage-source">
              {triage?.source === "gemini" ? `Ranked by Gemini (${triage.model}). Suggestions only: you decide.` : triage?.note ?? "Ranked by the built-in rules."}
            </p>
          </div>
          {triage && triage.items.length ? (
            <ol className="queue-list">
              {triage.items.map((r) => (
                <li key={r.incident}>
                  <button
                    type="button"
                    className="call"
                    data-new={String(fresh.has(r.incident))}
                    data-status={snap?.incidents.find((i) => i.key === r.incident)?.status ?? "open"}
                    aria-pressed={selectedId === r.household}
                    onClick={() => choose(r.household)}
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
                    <span className="call-meta">{ACTION_TEXT[r.action]}. Waiting {r.waitMinutes} min. Speaks {r.lang === "fr" ? "French" : "English"}.</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="quiet">
              <span className="quiet-light" aria-hidden="true" />
              <p className="quiet-title">All quiet on the street</p>
              <p className="section-sub">
                {counts.ok + counts.unknown} homes, no open calls. {nodesFresh} of {nodesTotal} nodes reporting. A call appears here the moment any node reaches the city.
              </p>
            </div>
          )}
          <p className="keys">
            <kbd>J</kbd> <kbd>K</kbd> move <kbd>C</kbd> call <kbd>D</kbd> dispatch <kbd>S</kbd> safe <kbd>Esc</kbd> clear
          </p>
        </aside>

        <aside className="glass ops-right" aria-labelledby="detail-h">
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
                {voice.lines.length ? (
                  <ol className="transcript" aria-live="polite">
                    {voice.lines.map((l, i) => (
                      <li key={i} className="line" data-who={l.who}>{l.text}</li>
                    ))}
                  </ol>
                ) : null}
                {voice.state !== "idle" && voice.state !== "error" ? <button className="btn btn-quiet btn-small" type="button" onClick={voice.end}>End call</button> : null}
              </section>
              {trail.length ? (
                <section className="trail" aria-labelledby="trail-h">
                  <h3 id="trail-h" className="section-title">How this reached you</h3>
                  <ol>
                    {trail.map((t) => (
                      <li key={t.id} data-kind={t.kind}>
                        <span className="trail-time mono">{clock(t.at)}</span>
                        <span className="trail-body">
                          <strong>{KIND_TEXT[t.kind] ?? t.kind}</strong>
                          <span>
                            Signed by {t.by}
                            {t.source === "beacon" && t.beacon ? ` from beacon ${t.beacon}` : ""}.{" "}
                            {t.via ? (t.via === t.by ? `Delivered by ${t.via}.` : `Relayed to the city by ${t.via}.`) : t.by === "the city" ? "Created in this room." : "Loaded from storage."}
                          </span>
                          <span className="verified">Signature verified</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </>
          ) : (
            <section aria-labelledby="detail-h">
              <h2 id="detail-h" className="section-title">The street right now</h2>
              <p className="section-sub">Select a home to see who lives there, what they need, and how their calls reached you.</p>
              <ul className="street">
                {(snap?.households ?? []).map((h) => (
                  <li key={h.id}>
                    <button type="button" className="street-row" onClick={() => choose(h.id)}>
                      <span className="street-dot" data-status={h.status} aria-hidden="true" />
                      <span className="street-name">{h.label}</span>
                      <span className="status-word" data-status={h.status}>{STATUS_TEXT[h.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="glass ops-dock" aria-label="Network health">
          <Timeline buckets={snap?.timeline.buckets ?? []} source={snap?.timeline.source ?? "memory"} />
          <div>
            <p className="section-title">Held offline</p>
            {snap && snap.holdSeconds.n > 0 ? (
              <dl className="kv">
                <dt>Typical wait</dt>
                <dd>{snap.holdSeconds.p50} s</dd>
                <dt>Slowest 5%</dt>
                <dd>{snap.holdSeconds.p95} s</dd>
                <dt>Stored</dt>
                <dd>{snap.counts.events} in {snap.storage === "tiger-data" ? "Tiger Data" : "memory"}</dd>
              </dl>
            ) : (
              <p className="section-sub">Nothing held yet. During an outage, this shows how long calls waited on the street before reaching you.</p>
            )}
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
      {notice ? <p className="toast">{notice}</p> : null}
    </div>
  );
}
