"use client";

/*
 * The landing page as a scroll-driven film. The 3D city is fixed behind the page and the scroll
 * position drives the camera, the storm front and the story beats, so scrolling back rewinds it.
 * Lenis smooths the scroll; everything else is requestAnimationFrame, IntersectionObserver and CSS.
 * One orchestrated moment: when the derecho crosses the city, the page itself loses power, and its
 * lights come back when the link returns.
 */
import { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import CityCanvas from "@/components/city/CityCanvas";
import { BrandMark } from "@/components/ui/Brand";
import { IconBulb, IconEye, IconMove } from "@/components/ui/Icons";
import type { HouseholdStatus, PorchlightCity } from "@/lib/city/scene";
import type { SimReport } from "@/lib/public-data";

type V3 = readonly [number, number, number];

/** Camera at the start of each section; section i flies from STOPS[i] to STOPS[i + 1]. */
const STOPS: { pos: V3; look: V3 }[] = [
  { pos: [262, 160, 300], look: [0, 5, 0] },
  { pos: [190, 110, 210], look: [0, 20, -40] },
  { pos: [60, 55, 40], look: [0, 40, -110] },
  { pos: [210, 190, 270], look: [0, 0, 0] },
  { pos: [45, 60, 215], look: [-30, 0, 120] },
  { pos: [22, 36, 172], look: [-24, 4, 118] },
  { pos: [28, 22, 152], look: [9, 6, 112] },
  { pos: [45, 85, 235], look: [-35, 0, 115] },
  { pos: [62, 72, 228], look: [-40, 0, 120] },
  { pos: [-5, 95, 150], look: [-80, 30, 30] },
  { pos: [85, 125, 265], look: [-30, 0, 60] },
  { pos: [28, 30, 160], look: [9, 6, 112] },
  { pos: [250, 200, 320], look: [0, 0, 0] },
  { pos: [300, 150, 300], look: [0, 10, -20] },
];

/** Storm front position at the start and end of each section: 0 all lights on, 1 all dark. */
const BLACKOUT: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 0.45],
  [0.45, 0.45],
  [0.45, 0.45],
  [0.45, 0.45],
  [0.45, 0],
  [0, 0],
];

const CHAPTERS = [
  "Porchlight",
  "A normal night",
  "The derecho",
  "What is left",
  "One button",
  "Buddies first",
  "Home to home",
  "The link returns",
  "Silence",
  "Who first",
  "Her language",
  "Proof",
  "Join",
];

const FRAME = ["01", "01", "34", "12", "00", "00", "07", "00", "00", "00", "5b", "cd", "4d", "fa", "29", "85", "ca", "76"];
const FR_LINE = "Bonjour, ici Porchlight pour la Ville. Nous avons reçu votre appel à l'aide. Êtes-vous en sécurité en ce moment?";

const ease = (t: number) => t * t * (3 - 2 * t);
const lerp3 = (a: V3, b: V3, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function Count({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const [v, setV] = useState(0);
  const [run, setRun] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setRun(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1600);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return (
    <span className="tabular" ref={ref}>
      {v.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

interface Props {
  households: { id: string; label: string; lang: "en" | "fr" }[];
  nodeHouseIds: string[];
  needs: Record<string, string[]>;
  sim: SimReport | null;
  repo: string;
}

export default function StoryScroll({ households, nodeHouseIds, needs, sim, repo }: Props) {
  const cityRef = useRef<PorchlightCity | null>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rail = useRef<HTMLElement>(null);
  const top = useRef<HTMLElement>(null);
  const lenisRef = useRef<Lenis | null>(null);

  const byLabel = (needle: string) => households.find((h) => h.label.toLowerCase().includes(needle))?.id ?? households[0]!.id;
  const ids = {
    caller: households[0]!.id,
    pine: byLabel("pine"),
    willow: byLabel("willow"),
    elm: byLabel("elm"),
    buddies: [byLabel("oak"), byLabel("birch")],
    all: households.map((h) => h.id),
  };
  const label = (id: string) => households.find((h) => h.id === id)?.label ?? id;

  // Reveal each section once, the first time it scrolls into view. Written straight to the DOM,
  // so reveals never wait for a React render, even on a slow machine.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) (e.target as HTMLElement).dataset.visible = "true";
      },
      { threshold: 0.25 },
    );
    sections.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  // The scroll engine: every frame, map the scroll position onto camera, storm and story beats.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lenis = reduced ? null : new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
    lenisRef.current = lenis;
    const root = document.documentElement;
    let raf = 0;
    let current = -1;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let blurShown = 0;
    let boxes: { top: number; h: number }[] = [];
    const measure = () => {
      boxes = sections.current.map((el) => ({ top: el?.offsetTop ?? 0, h: el?.offsetHeight ?? 1 }));
    };
    measure();
    window.addEventListener("resize", measure);

    const statusesFor = (i: number): Record<string, HouseholdStatus> => {
      const s: Record<string, HouseholdStatus> = Object.fromEntries(ids.all.map((id) => [id, "unknown" as HouseholdStatus]));
      if (i >= 4 && i <= 6) s[ids.caller] = "help";
      if (i >= 7 && i <= 10) {
        s[ids.caller] = "acknowledged";
        s[ids.pine] = "help";
        s[ids.willow] = "help";
      }
      if (i >= 8 && i <= 10) s[ids.elm] = "silent";
      if (i >= 11) for (const id of ids.all) s[id] = "ok";
      return s;
    };

    const enter = (city: PorchlightCity, i: number, prev: number) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
      city.setStorm(i === 2);
      city.setCityLink(i <= 1 || i >= 7);
      for (const [id, st] of Object.entries(statusesFor(i))) city.setHouseholdStatus(id, st);
      city.setBuddyArcs(i === 5 ? ids.buddies.map((from) => ({ from, to: ids.caller })) : []);
      city.setHouseholdLights(ids.pine, i >= 8 && i <= 10 ? "off" : null);
      if (i === 6) {
        const path = [ids.caller, ...nodeHouseIds];
        for (let round = 0; round < 2; round++) path.slice(1).forEach((to, k) => later(300 + round * 2400 + k * 700, () => city.pulse(path[k]!, to, "#ff6a55")));
      }
      if (i === 7 && prev < 7) nodeHouseIds.forEach((n, k) => later(250 + k * 450, () => city.uplink(n)));
      rail.current?.querySelectorAll("button").forEach((b, k) => {
        if (k === i) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
        b.dataset.past = String(k < i);
      });
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      lenis?.raf(now);
      const city = cityRef.current;
      const y = window.scrollY;
      if (top.current) top.current.dataset.scrolled = String(y > 40);
      if (!city || !boxes.length) return;
      const mid = y + window.innerHeight * 0.5;
      let i = boxes.findIndex((b) => mid >= b.top && mid < b.top + b.h);
      if (i < 0) i = mid < boxes[0]!.top ? 0 : boxes.length - 1;
      const b = boxes[i]!;
      const t = ease(Math.min(1, Math.max(0, (mid - b.top) / b.h)));
      const from = STOPS[i]!;
      const to = STOPS[i + 1] ?? from;
      const pos = lerp3(from.pos, to.pos, t);
      if (!reduced) {
        pos[0] += Math.sin(now * 0.00018) * 5;
        pos[1] += Math.sin(now * 0.00023) * 2.5;
        pos[2] += Math.cos(now * 0.00018) * 5;
      }
      city.setView(pos, lerp3(from.look, to.look, t));
      const [b0, b1] = BLACKOUT[i] ?? [0, 0];
      const dark = b0 + (b1 - b0) * t;
      city.setBlackoutNow(dark);
      const out = dark > 0.6 ? "true" : "false";
      if (root.dataset.blackout !== out) root.dataset.blackout = out;
      if (i !== current) {
        const prev = current;
        current = i;
        enter(city, i, prev);
      }
      // Motion blur on fast scrolling, like a camera panning quickly.
      const dt = Math.max(1, now - lastT);
      const v = Math.abs(y - lastY) / dt;
      lastY = y;
      lastT = now;
      const blur = reduced ? 0 : Math.min(3, Math.max(0, (v - 1.2) * 1.4));
      if (canvasWrap.current && Math.abs(blur - blurShown) > 0.15) {
        blurShown = blur;
        canvasWrap.current.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : "";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      timers.current.forEach(clearTimeout);
      lenis?.destroy();
      lenisRef.current = null;
      delete root.dataset.blackout;
    };
    // Households are static for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (i: number) => (el: HTMLElement | null) => {
    sections.current[i] = el;
  };
  const delay = (ms: number) => ({ transitionDelay: `${ms}ms` });
  const go = (i: number) => {
    const el = sections.current[i];
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el, { duration: 1.8 });
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const playVoice = () => {
    const audio = new Audio("/audio/present/checkin-fr.mp3");
    audio.play().catch(() => {
      const u = new SpeechSynthesisUtterance(FR_LINE);
      u.lang = "fr-CA";
      window.speechSynthesis?.speak(u);
    });
  };

  const headline = "When the grid goes dark, the porch lights stay on.".split(" ");
  const d = (i: number) => delay(i);

  return (
    <div className="story">
      <div className="story-canvas" ref={canvasWrap} aria-hidden="true">
        <CityCanvas households={households} nodeHouseIds={nodeHouseIds} labels={false} interactive={false} onReady={(c) => (cityRef.current = c)} />
      </div>
      <div className="story-shade" aria-hidden="true" />
      <div className="story-grain" aria-hidden="true" />

      <header className="story-top" ref={top}>
        <a className="brand" href="/">
          <BrandMark />
          <span className="brand-name">Porchlight</span>
        </a>
        <nav className="story-nav" aria-label="Main">
          <a className="btn btn-quiet btn-small" href="/present">Story mode</a>
          <a className="btn btn-quiet btn-small" href="/ops">Operations room</a>
          <a className="btn btn-quiet btn-small" href={repo} rel="noreferrer">Source code</a>
        </nav>
      </header>

      <nav className="story-rail" aria-label="Chapters" ref={rail}>
        {CHAPTERS.map((c, i) => (
          <button key={c} type="button" aria-label={c} aria-current={i === 0 ? "step" : undefined} onClick={() => go(i)}>
            <span className="rail-label">{c}</span>
          </button>
        ))}
      </nav>

      <main>
        <section ref={set(0)} data-index={0} className="story-section story-hero" data-visible="true">
          <div className="hero-copy">
            <h1 className="hero-title">
              {headline.map((w, i) => (
                <span key={i}>
                  <span className="word" style={{ animationDelay: `${200 + i * 90}ms` }}>{w}</span>{" "}
                </span>
              ))}
            </h1>
            <p className="hero-sub word" style={{ animationDelay: "1150ms" }}>
              Porchlight is an emergency network that neighbours run themselves. It works with no power, no internet and no
              cell service, and when the City comes back online, it knows who to reach first.
            </p>
            <div className="hero-actions word" style={{ animationDelay: "1350ms" }}>
              <a className="btn btn-porch" href="#night" onClick={(e) => { e.preventDefault(); go(1); }}>Live through the storm</a>
              <a className="btn btn-quiet" href="/ops">Open the operations room</a>
            </div>
          </div>
          <button className="scroll-cue" type="button" onClick={() => go(1)} aria-label="Scroll to the next chapter">
            <span>Scroll</span>
            <span className="scroll-line" aria-hidden="true" />
          </button>
        </section>

        <section id="night" ref={set(1)} data-index={1} className="story-section">
          <div className="story-card">
            <p className="dateline reveal">Ottawa, a normal night</p>
            <h2 className="story-title reveal" style={d(100)}>Every light in this city depends on the grid.</h2>
            <p className="story-body reveal" style={d(220)}>So does every phone, every router, and every outage map people would use to ask for help.</p>
          </div>
        </section>

        <section ref={set(2)} data-index={2} className="story-section" data-side="right">
          <div className="story-card">
            <p className="dateline reveal">May 21, 2022</p>
            <h2 className="story-title reveal" style={d(100)}>A derecho crosses the city at 120 km/h.</h2>
            <p className="fact reveal" style={d(220)}>
              <b><Count to={180000} /></b> Hydro Ottawa customers lost power at the peak, more than half the city. The utility even
              took its own outage map offline.
            </p>
            <p className="fine reveal" style={d(320)}>
              <a href="https://hydroottawa.com/en/about-us/regulatory-affairs/major-events/May-21-2022" rel="noreferrer">Hydro Ottawa, May 21, 2022 major event report</a>
            </p>
          </div>
        </section>

        <section ref={set(3)} data-index={3} className="story-section">
          <div className="story-card">
            <p className="dateline reveal">Minutes later</p>
            <h2 className="story-title reveal" style={d(100)}>Three homes still glow.</h2>
            <p className="story-body reveal" style={d(220)}>
              They run Porchlight nodes on laptops and batteries. No internet, no cell service, and they can still hear each other.
            </p>
          </div>
        </section>

        <section ref={set(4)} data-index={4} className="story-section">
          <div className="story-card">
            <p className="dateline reveal">{label(ids.caller)}</p>
            <h2 className="story-title reveal" style={d(100)}>One button. No app, no account, no signal.</h2>
            <p className="story-body reveal" style={d(220)}>
              Her beacon signs the call with its own key and sends 18 bytes over Bluetooth. If she falls and cannot press it, the
              beacon notices the fall and calls for her after a ten second countdown she can cancel.
            </p>
            <div className="frame" aria-label="The 18 byte beacon frame">
              {FRAME.map((b, i) => (
                <span key={i} className={`byte reveal ${i < 2 ? "byte-head" : i < 10 ? "byte-count" : "byte-tag"}`} style={d(400 + i * 55)}>
                  {b}
                </span>
              ))}
            </div>
            <p className="frame-legend reveal" style={d(1500)}>
              <span className="byte-head">version and kind</span>
              <span className="byte-count">session and press counter</span>
              <span className="byte-tag">authentication tag</span>
            </p>
          </div>
        </section>

        <section ref={set(5)} data-index={5} className="story-section" data-side="right">
          <div className="story-card">
            <p className="dateline reveal">Porch Circles</p>
            <h2 className="story-title reveal" style={d(100)}>Her neighbours hear it first.</h2>
            <p className="story-body reveal" style={d(220)}>
              Two neighbours agreed to watch out for her. They get the call before anyone else, and it only widens if nobody answers.
            </p>
            <ol className="steps">
              <li className="reveal" style={d(380)}><span><strong>Her buddies</strong>, for the first moments.</span></li>
              <li className="reveal" style={d(500)}><span><strong>The whole street</strong>, if no buddy answers.</span></li>
              <li className="reveal" style={d(620)}><span><strong>The City</strong>, if nobody on the street can go.</span></li>
            </ol>
            <p className="fine reveal" style={d(760)}>
              When a neighbour taps On my way, her beacon turns green. Replies are signed too, so nobody can fake reassurance.
            </p>
          </div>
        </section>

        <section ref={set(6)} data-index={6} className="story-section" data-side="right">
          <div className="story-card">
            <p className="dateline reveal">The street passes it on</p>
            <h2 className="story-title reveal" style={d(100)}>The call hops from home to home.</h2>
            <svg className="hops reveal" style={d(200)} viewBox="0 0 420 120" role="img" aria-label="Beacon to node A to node B to node C">
              <path className="hop-path" d="M40 70 Q95 20 150 70 T270 70 T380 70" />
              {[40, 150, 270, 380].map((x, i) => (
                <g key={x}>
                  <circle cx={x} cy={70} r={i === 0 ? 9 : 12} className={i === 0 ? "hop-beacon" : "hop-node"} />
                  <text x={x} y={108} textAnchor="middle" className="hop-text">{i === 0 ? "Beacon" : `Node ${"ABC"[i - 1]}`}</text>
                </g>
              ))}
              <circle r="5" className="hop-dot">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M40 70 Q95 20 150 70 T270 70 T380 70" />
              </circle>
            </svg>
            <ul className="chips">
              {["Signature checked", "Stored", "Passed on", "Gaps repaired next round"].map((c, i) => (
                <li key={c} className="chip reveal" style={d(600 + i * 160)}>{c}</li>
              ))}
            </ul>
          </div>
        </section>

        <section ref={set(7)} data-index={7} className="story-section" data-side="right">
          <div className="story-card">
            <p className="dateline reveal">The link returns</p>
            <h2 className="story-title reveal" style={d(100)}>When any node reaches the City, everything it held arrives.</h2>
            <ul className="chips">
              {["Verified again at City Hall", "Written to Tiger Data first", "Counted exactly once", "Readable by the City's own systems through Open311"].map((c, i) => (
                <li key={c} className="chip reveal" style={d(300 + i * 160)}>{c}</li>
              ))}
            </ul>
          </div>
        </section>

        <section ref={set(8)} data-index={8} className="story-section">
          <div className="story-card">
            <p className="dateline reveal">{label(ids.elm)}</p>
            <h2 className="story-title reveal" style={d(100)}>Some people cannot press a button. Silence is a signal.</h2>
            <p className="story-body reveal" style={d(220)}>
              Once an emergency is declared, Porchlight watches for vulnerable homes that go quiet, and ranks them by risk. The
              beacon itself reports small signs of life.
            </p>
            <div className="signs">
              <div className="sign reveal" style={d(380)}>
                <IconMove />
                <strong>Moved</strong>
                <span>The motion sensor feels the beacon being picked up.</span>
              </div>
              <div className="sign reveal" style={d(500)}>
                <IconEye />
                <strong>Someone seen</strong>
                <span>The camera notices movement in the room. The image never leaves the chip.</span>
              </div>
              <div className="sign reveal" data-alarm="true" style={d(620)}>
                <IconBulb />
                <strong>Lights out</strong>
                <span>If her home needs power for medical equipment, she moves up the list.</span>
              </div>
            </div>
          </div>
        </section>

        <section ref={set(9)} data-index={9} className="story-section">
          <div className="story-card">
            <p className="dateline reveal">City Hall</p>
            <h2 className="story-title reveal" style={d(100)}>Gemini helps decide who to reach first.</h2>
            <p className="story-body reveal" style={d(220)}>It sees anonymous references and needs, never names or addresses. It suggests. A coordinator decides.</p>
            <ol className="ranks">
              {[ids.caller, ids.pine, ids.willow].map((id, i) => (
                <li key={id} className="rank reveal" style={d(400 + i * 180)}>
                  <span className="rank-n">{i + 1}</span>
                  <span>
                    <strong>{label(id)}</strong>
                    <span className="rank-needs">{(needs[id] ?? []).join(", ") || "No needs recorded"}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="fine reveal" style={d(1000)}>An example ranking for this story.</p>
          </div>
        </section>

        <section ref={set(10)} data-index={10} className="story-section" data-side="right">
          <div className="story-card">
            <p className="dateline reveal">{label(ids.elm)}</p>
            <h2 className="story-title reveal" style={d(100)}>Porchlight calls her, in her own language.</h2>
            <div className="wave reveal" style={d(250)} aria-hidden="true">
              {Array.from({ length: 36 }, (_, i) => (
                <span key={i} style={{ animationDelay: `${(i * 97) % 900}ms`, height: `${30 + ((i * 37) % 60)}%` }} />
              ))}
            </div>
            <p className="quote reveal" lang="fr" style={d(400)}>&ldquo;{FR_LINE}&rdquo;</p>
            <p className="fine reveal" style={d(500)}>
              An ElevenLabs voice agent asks whether she is safe, in English or French. If she says she is not, the City opens a new call.
              Coordinators talk to Porchlight too: &ldquo;Who needs help first?&rdquo;
            </p>
            <div className="reveal" style={d(600)}>
              <button className="btn btn-porch" type="button" onClick={playVoice}>Play the call</button>
            </div>
          </div>
        </section>

        <section ref={set(11)} data-index={11} className="story-section">
          <div className="story-card story-card-wide">
            <p className="dateline reveal">We tried to break it</p>
            <h2 className="story-title reveal" style={d(100)}>Nothing got lost.</h2>
            {sim ? (
              <dl className="proof">
                <div className="reveal" style={d(250)}>
                  <dt>Alerts delivered</dt>
                  <dd><Count to={sim.results.eventsAtCity} /> <small>of {sim.results.eventsInjected}</small></dd>
                </div>
                <div className="reveal" style={d(350)}>
                  <dt>Messages dropped on purpose</dt>
                  <dd><Count to={Math.round(sim.results.measuredLossRate * 100)} suffix="%" /></dd>
                </div>
                <div className="reveal" style={d(450)}>
                  <dt>City outages survived</dt>
                  <dd><Count to={sim.params.cycles} /></dd>
                </div>
                <div className="reveal" style={d(550)}>
                  <dt>Typical time to reach every node</dt>
                  <dd><Count to={sim.results.propagationSeconds.p50} decimals={1} suffix=" s" /></dd>
                </div>
              </dl>
            ) : null}
            <p className="fine reveal" style={d(700)}>
              {sim ? `${sim.params.nodes} simulated nodes. A simulation, not a field test.` : "Run npm run sim:ci to measure it yourself."}
            </p>
          </div>
        </section>

        <section ref={set(12)} data-index={12} className="story-section story-end">
          <div className="end-copy">
            <h2 className="end-title reveal">When the grid goes dark, the porch lights stay on.</h2>
            <div className="hero-actions reveal" style={{ ...d(200), justifyContent: "center" }}>
              <a className="btn btn-porch" href="/present">Watch the story</a>
              <a className="btn btn-quiet" href="/ops">Open the operations room</a>
              <a className="btn btn-quiet" href={repo} rel="noreferrer">Source code</a>
            </div>
            <p className="fine reveal" style={d(350)}>Open source under Apache 2.0. Built at Hack the Hill III, Ottawa, September 2026.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
