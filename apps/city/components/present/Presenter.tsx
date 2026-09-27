"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CityCanvas from "@/components/city/CityCanvas";
import type { FocusTarget, HouseholdStatus, PorchlightCity } from "@/lib/city/scene";
import type { SimReport } from "@/lib/public-data";

interface Props {
  households: { id: string; label: string; lang: "en" | "fr" }[];
  nodeHouseIds: string[];
  needs: Record<string, string[]>;
  sim: SimReport | null;
}

interface ChapterState {
  blackout: number;
  storm: boolean;
  link: boolean;
  statuses: Record<string, HouseholdStatus>;
  focus: FocusTarget;
  rotate: boolean;
}

interface Chapter {
  kicker: string;
  title: string;
  body: React.ReactNode;
  state: (ids: Ids) => ChapterState;
  animate?: (city: PorchlightCity, ids: Ids, later: (ms: number, fn: () => void) => void) => void;
  panel?: "triage" | "voice" | "numbers";
}

interface Ids {
  caller: string;
  pine: string;
  willow: string;
  nodes: string[];
  all: string[];
}

const FR_SCRIPT = "Bonjour, ici Porchlight pour la Ville. Nous avons reçu votre appel à l'aide. Êtes-vous en sécurité en ce moment?";

const base = (ids: Ids, over: Partial<ChapterState> = {}): ChapterState => ({
  blackout: 0,
  storm: false,
  link: true,
  statuses: Object.fromEntries(ids.all.map((id) => [id, "unknown" as HouseholdStatus])),
  focus: "overview",
  rotate: false,
  ...over,
});

function chapters(sim: SimReport | null): Chapter[] {
  return [
    {
      kicker: "Ottawa, a normal night",
      title: "Every light in this city depends on the grid.",
      body: "So does every phone, every router, and every outage map.",
      state: (ids) => base(ids, { rotate: true }),
    },
    {
      kicker: "May 21, 2022",
      title: "A derecho crosses the city at 120 km/h.",
      body: (
        <>
          At the peak, 180,000 Hydro Ottawa customers had no power, and the utility took its own outage map offline.{" "}
          <a href="https://hydroottawa.com/en/about-us/regulatory-affairs/major-events/May-21-2022" rel="noreferrer">Source: Hydro Ottawa</a>
        </>
      ),
      state: (ids) => base(ids, { blackout: 1, storm: true, link: false }),
    },
    {
      kicker: "What is left",
      title: "Three homes still glow.",
      body: "They run Porchlight nodes on laptops and batteries. No internet, no cell service, and they can still hear each other.",
      state: (ids) => base(ids, { blackout: 1, link: false, focus: "crescent" }),
    },
    {
      kicker: "12 Maple Crescent",
      title: "She presses the button on her beacon.",
      body: "The beacon signs the alert with its own key and sends it over Bluetooth to the nearest node. No app, no account, no signal.",
      state: (ids) => base(ids, { blackout: 1, link: false, focus: ids.caller, statuses: { ...base(ids).statuses, [ids.caller]: "help" } }),
    },
    {
      kicker: "Neighbours pass it on",
      title: "The alert hops from home to home.",
      body: "Every node checks the signature, stores the alert, and gossips it onward. If a message drops, the next exchange repairs it.",
      state: (ids) => base(ids, { blackout: 1, link: false, focus: "crescent", statuses: { ...base(ids).statuses, [ids.caller]: "help" } }),
      animate: (city, ids, later) => {
        const path = [ids.caller, ...ids.nodes];
        for (let round = 0; round < 2; round++)
          path.slice(1).forEach((to, i) => later(round * 2600 + i * 800, () => city.pulse(path[i]!, to, "#ff6a55")));
      },
    },
    {
      kicker: "Someone is coming",
      title: "A neighbour taps “I'm on my way.”",
      body: "Her beacon turns green. The acknowledgement is signed too, so nobody can fake reassurance.",
      state: (ids) => base(ids, { blackout: 1, link: false, focus: ids.caller, statuses: { ...base(ids).statuses, [ids.caller]: "acknowledged" } }),
      animate: (city, ids, later) => ids.nodes[0] && later(300, () => city.pulse(ids.nodes[0]!, ids.caller, "#9ec5ff")),
    },
    {
      kicker: "The link returns",
      title: "When any node reaches the city, everything it held arrives.",
      body: "City Hall verifies every alert again and stores it in Tiger Data. Nothing is lost, and nothing is counted twice.",
      state: (ids) =>
        base(ids, {
          blackout: 0.9,
          link: true,
          focus: "cityhall",
          statuses: { ...base(ids).statuses, [ids.caller]: "acknowledged", [ids.pine]: "help", [ids.willow]: "help" },
        }),
      animate: (city, ids, later) => ids.nodes.forEach((n, i) => later(400 + i * 600, () => city.uplink(n))),
    },
    {
      kicker: "Who first",
      title: "Gemini helps decide who to reach first.",
      body: "It sees anonymous references and needs, never names or addresses. It suggests. A coordinator decides.",
      state: (ids) =>
        base(ids, {
          blackout: 0.9,
          link: true,
          focus: "crescent",
          statuses: { ...base(ids).statuses, [ids.caller]: "acknowledged", [ids.pine]: "help", [ids.willow]: "help" },
        }),
      panel: "triage",
    },
    {
      kicker: "In her own language",
      title: "Porchlight calls her, in her own language.",
      body: "An ElevenLabs voice agent asks, in English or French, whether she is safe. If she says she is not, the City opens a new call. Every action it takes is signed and shown to the coordinator.",
      state: (ids) =>
        base(ids, {
          blackout: 0.9,
          link: true,
          focus: ids.caller,
          statuses: { ...base(ids).statuses, [ids.caller]: "acknowledged", [ids.pine]: "help", [ids.willow]: "help" },
        }),
      panel: "voice",
    },
    {
      kicker: "We tried to break it",
      title: sim ? `${sim.results.eventsLost} of ${sim.results.eventsInjected} alerts lost.` : "Measured, not promised.",
      body: sim
        ? `In simulation: ${sim.params.nodes} nodes, ${Math.round(sim.results.measuredLossRate * 100)}% of all messages dropped, and the city link cut ${sim.params.cycles} times. A simulation, not a field test.`
        : "Run the chaos harness with npm run sim:ci to measure it yourself.",
      state: (ids) => base(ids, { blackout: 0.4, link: true, rotate: true }),
      panel: "numbers",
    },
    {
      kicker: "Porchlight",
      title: "When the grid goes dark, the porch lights stay on.",
      body: "Open source. Built at Hack the Hill III.",
      state: (ids) => base(ids, { blackout: 0, rotate: true, statuses: Object.fromEntries(ids.all.map((id) => [id, "ok" as HouseholdStatus])) }),
      animate: (city, ids, later) => ids.all.forEach((id, i) => later(i * 150, () => city.setHouseholdStatus(id, "ok"))),
    },
  ];
}

export default function Presenter({ households, nodeHouseIds, needs, sim }: Props) {
  const list = chapters(sim);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const cityRef = useRef<PorchlightCity | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const byLabel = (needle: string) => households.find((h) => h.label.toLowerCase().includes(needle))?.id ?? households[0]!.id;
  const ids: Ids = {
    caller: households[0]!.id,
    pine: byLabel("pine"),
    willow: byLabel("willow"),
    nodes: nodeHouseIds,
    all: households.map((h) => h.id),
  };

  const apply = useCallback(
    (i: number) => {
      const city = cityRef.current;
      if (!city) return;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      window.speechSynthesis?.cancel();
      const ch = list[i]!;
      const st = ch.state(ids);
      city.setStorm(st.storm);
      city.setBlackout(st.blackout, 0.3);
      city.setCityLink(st.link);
      for (const [id, s] of Object.entries(st.statuses)) city.setHouseholdStatus(id, s);
      city.focus(st.focus);
      city.setAutoRotate(st.rotate);
      ch.animate?.(city, ids, (ms, fn) => timers.current.push(setTimeout(fn, ms)));
      if (ch.panel === "voice") {
        timers.current.push(
          setTimeout(() => {
            const audio = new Audio("/audio/present/checkin-fr.mp3");
            audio.play().catch(() => {
              const u = new SpeechSynthesisUtterance(FR_SCRIPT);
              u.lang = "fr-CA";
              window.speechSynthesis?.speak(u);
            });
          }, 900),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [households, nodeHouseIds],
  );

  useEffect(() => apply(index), [index, apply]);

  const go = useCallback((d: number) => setIndex((i) => Math.min(list.length - 1, Math.max(0, i + d))), [list.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key.toLowerCase() === "a") setAuto((a) => !a);
      else if (e.key.toLowerCase() === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => (index < list.length - 1 ? go(1) : setAuto(false)), 9000);
    return () => clearTimeout(t);
  }, [auto, index, go, list.length]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const ch = list[index]!;
  const label = (id: string) => households.find((h) => h.id === id)?.label ?? id;

  return (
    <main className="present">
      <div className="present-city" aria-hidden="true">
        <CityCanvas
          households={households}
          nodeHouseIds={nodeHouseIds}
          labels="active"
          onReady={(c) => {
            cityRef.current = c;
            apply(index);
          }}
        />
      </div>
      <nav className="present-progress" aria-label="Chapters">
        {list.map((c, i) => (
          <button
            key={c.kicker}
            type="button"
            className="present-step"
            aria-label={`Chapter ${i + 1}: ${c.kicker}`}
            aria-current={i === index ? "step" : undefined}
            onClick={() => setIndex(i)}
          />
        ))}
      </nav>
      <div className="present-controls">
        <button className="btn btn-quiet btn-small" type="button" onClick={() => go(-1)} disabled={index === 0}>Previous</button>
        <button className="btn btn-quiet btn-small" type="button" onClick={() => setAuto((a) => !a)}>{auto ? "Stop autoplay" : "Autoplay"}</button>
        <button className="btn btn-porch btn-small" type="button" onClick={() => go(1)} disabled={index === list.length - 1}>Next</button>
        <a className="btn btn-quiet btn-small" href="/">Exit</a>
      </div>

      {ch.panel === "triage" ? (
        <aside className="present-panel" aria-label="Example ranking">
          <p className="present-kicker">Example ranking for the story</p>
          <ol>
            {[ids.caller, ids.pine, ids.willow].map((id) => (
              <li key={id}>
                <strong>{label(id)}</strong>
                <p>{(needs[id] ?? []).join(", ") || "No needs recorded"}</p>
              </li>
            ))}
          </ol>
          <p className="hint-keys">In the operations room this list comes live from Gemini, with the built-in rules as a fallback.</p>
        </aside>
      ) : null}
      {ch.panel === "voice" ? (
        <aside className="present-panel" aria-label="Call transcript">
          <p className="present-kicker">Opening line</p>
          <p lang="fr">{FR_SCRIPT}</p>
          <p className="hint-keys">“Hello, this is Porchlight calling for the city. We received your call for help. Are you safe right now?”</p>
        </aside>
      ) : null}
      {ch.panel === "numbers" && sim ? (
        <aside className="present-panel" aria-label="Simulation results">
          <p className="big-number">{sim.results.eventsLost}</p>
          <p>alerts lost out of {sim.results.eventsInjected}</p>
          <p className="hint-keys">
            Alerts reached every node in {sim.results.propagationSeconds.p50} s typically ({sim.results.propagationSeconds.p95} s for the slowest 5%). The city caught up {sim.results.recoveryAfterOutageSeconds.p50} s after each outage ended.
          </p>
        </aside>
      ) : null}

      <section className="present-caption" aria-live="polite">
        <p className="present-kicker">{ch.kicker}</p>
        <h2>{ch.title}</h2>
        <p>{ch.body}</p>
        <p className="hint-keys">Arrow keys or space to move, A for autoplay, F for full screen.</p>
      </section>
    </main>
  );
}
