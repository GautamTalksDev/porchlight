"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import CityCanvas from "@/components/city/CityCanvas";
import { Brand } from "@/components/ui/Brand";
import type { CityMessage, CitySnapshot } from "@/lib/city";
import type { PorchlightCity } from "@/lib/city/scene";
import { isFall } from "@/lib/fall";
import { formatJourneyBreadcrumb, journeyFromTrail, resolveNodeHouseholds, type JourneyHop } from "@/lib/journey";
import { aliveTrailLabel, formatSignsOfLifeLine } from "@/lib/power";
import { guidanceForNeeds } from "@/lib/needs-guidance";
import type { TriageResult } from "@/lib/triage";
import { Timeline } from "./Timeline";
import { CommandMenu, JourneyChain, Vitals, type MenuGroup } from "./OpsParts";
import {
  IconBolt,
  IconCheck,
  IconClose,
  IconExit,
  IconFeed,
  IconFilm,
  IconGauge,
  IconInfo,
  IconMegaphone,
  IconPhone,
  IconReplay,
  IconReset,
  IconShield,
  IconSiren,
  IconSound,
  IconUplink,
  IconWalk,
} from "@/components/ui/Icons";
import { useCopilot } from "./useCopilot";
import { useVoiceCall } from "./useVoiceCall";
import { NoticesPanel, type NoticesApi } from "./NoticesPanel";
import type { CopilotLive } from "./useCopilot";
import { summarizePreflight, type PreflightCheck } from "@/lib/preflight";

/** Build journey hops for a home from the snapshot trail (and server-built journeys when present). */
function journeyHopsFor(snap: CitySnapshot, householdId: string): JourneyHop[] {
  if (snap.journeys?.[householdId]?.length) return snap.journeys[householdId]!;
  const house = snap.households.find((h) => h.id === householdId);
  if (!house) return [];
  const nodeHouseholds = resolveNodeHouseholds({
    registryNodes: { ...(snap.nodeHouses ?? {}), ...(snap.nodeHouseholds ?? {}) },
    liveNodes: snap.nodes ?? [],
  });
  const householdLabels: Record<string, string> = {};
  for (const h of snap.households) householdLabels[h.id] = h.label;
  const open = (snap.incidents ?? []).some((i) => i.household === householdId && i.status !== "resolved");
  return journeyFromTrail({
    householdId,
    householdLabel: house.label,
    trail: snap.trail?.[householdId] ?? [],
    nodeHouseholds,
    householdLabels,
    nodes: (snap.nodes ?? []).map((n) => ({ id: n.id, name: n.name })),
    hasOpenCall: open,
  });
}

const STATUS_TEXT: Record<string, string> = { unknown: "Not heard from", ok: "Safe", help: "Needs help", acknowledged: "Help on the way" };
const ACTION_TEXT: Record<string, string> = { dispatch_neighbour: "Suggested: dispatch now", voice_check_in: "Suggested: call first", monitor: "Suggested: keep watching" };
const KIND_TEXT: Record<string, string> = { help: "Call for help", ok: "Marked safe", ack: "Help on the way", note: "Note" };
const TIER_CHIP: Record<string, { text: string; className: string }> = {
  buddies: { text: "Buddies alerted", className: "tag tag-tier-buddies" },
  street: { text: "Street alerted", className: "tag tag-tier-street" },
  city: { text: "No neighbour yet", className: "tag tag-tier-city" },
};

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

/** Reasons come from the model or the rules in lower case: show them as sentences. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** "just now" reads better than "0 min" on a call that has only just arrived. */
function waited(minutes: number): string {
  return minutes < 1 ? "just now" : `${minutes} min`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Arrival {
  key: string;
  household: string;
  label: string;
  fall: boolean;
}

export default function OpsRoom({
  coordinator,
  authMode,
  nodeHouseIds,
  demoResetEnabled = false,
}: {
  coordinator: string;
  authMode: string;
  nodeHouseIds: string[];
  demoResetEnabled?: boolean;
}) {
  const [snap, setSnap] = useState<CitySnapshot | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(true);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[] | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const noticesApiRef = useRef<NoticesApi | null>(null);
  const lastToastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const showToast = useCallback((text: string) => {
    const now = Date.now();
    if (lastToastRef.current.text === text && now - lastToastRef.current.at < 2000) return;
    lastToastRef.current = { text, at: now };
    setNotice(text);
  }, []);
  const emergencyBusyRef = useRef(false);
  const demoResetBusyRef = useRef(false);
  const [, setTick] = useState(0);
  const cityRef = useRef<PorchlightCity | null>(null);
  const snapRef = useRef<CitySnapshot | null>(null);
  const known = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  snapRef.current = snap;

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

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
        fetch("/api/state", { cache: "no-store" })
          .then((r) => {
            if (r.status === 401) setSessionEnded(true);
            else retry = setTimeout(connect, 2000);
          })
          .catch(() => {
            retry = setTimeout(connect, 2000);
          });
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

  // Amber buddy arcs while a call is still in the buddies window.
  useEffect(() => {
    const city = cityRef.current;
    if (!city || !snap) return;
    const links: { from: string; to: string }[] = [];
    for (const inc of snap.incidents) {
      if (inc.status !== "open" || inc.tier !== "buddies") continue;
      for (const b of inc.buddies ?? []) links.push({ from: b.id, to: inc.household });
    }
    city.setBuddyArcs(links);
  }, [snap]);

  // Triage
  const openKey = useMemo(
    () => (snap ? snap.incidents.filter((i) => i.status !== "resolved").map((i) => `${i.key}:${i.status}`).join("|") : ""),
    [snap],
  );
  const refreshTriage = useCallback(async () => {
    try {
      setTriage(await post("/api/triage", {}));
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [showToast]);
  useEffect(() => {
    if (!snap) return;
    const t = setTimeout(refreshTriage, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, refreshTriage, snap === null]);

  const voice = useVoiceCall(useCallback(() => void refreshTriage(), [refreshTriage]));

  const liveRef = useRef<CopilotLive>({
    snap: null,
    triage: null,
    counts: { help: 0, acknowledged: 0, ok: 0, unknown: 0 },
    nodesReporting: 0,
    nodesTotal: 0,
  });

  const choose = useCallback((id: string | null) => {
    if (id == null) {
      setSelected("");
      cityRef.current?.focus("ops");
      return;
    }
    setSelected(id);
    cityRef.current?.focus(id);
  }, []);

  const playJourneyFor = useCallback((householdId: string) => {
    const live = snapRef.current;
    if (!live) return;
    const hops = journeyHopsFor(live, householdId);
    if (!hops.length) return;
    cityRef.current?.playJourney(hops);
  }, []);

  const copilot = useCopilot({
    liveRef,
    noticesApiRef,
    onSelect: choose,
    onFocus: (target) => cityRef.current?.focus(target),
    onPlayJourney: playJourneyFor,
    onStartCheckIn: (householdId, incidentKey) => {
      void voice.start(householdId, incidentKey);
    },
    onToolUsed: () => void refreshTriage(),
  });

  const voiceBusy = voice.state !== "idle" && voice.state !== "error";
  const copilotBusy = copilot.state !== "idle" && copilot.state !== "error";
  const copilotOpen = copilot.state !== "idle";

  const startCopilot = useCallback(async () => {
    if (!copilot.available || voiceBusy) return;
    await voice.end();
    await copilot.start();
  }, [copilot.available, copilot.start, voice.end, voiceBusy]);

  const startResidentCall = useCallback(
    async (householdId: string, incidentKey: string | null) => {
      if (copilotBusy || copilotOpen) await copilot.end();
      await voice.start(householdId, incidentKey);
    },
    [copilot.end, copilotBusy, copilotOpen, voice.start],
  );

  // The arrival moment: a new call for help gets a chime, a banner, the camera, then the journey.
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
    setArrival({ key: first.key, household: first.household, label: first.label, fall: isFall(first.note) });
    setFresh(new Set(arrived.map((a) => a.key)));
    chime();
    let journeyTimer: ReturnType<typeof setTimeout> | undefined;
    if (voice.state === "idle" || voice.state === "error") {
      setSelected(first.household);
      cityRef.current?.focus(first.household);
      journeyTimer = setTimeout(() => playJourneyFor(first.household), 1700);
    }
    const t = setTimeout(() => setArrival(null), 7000);
    const f = setTimeout(() => setFresh(new Set()), 4000);
    return () => {
      clearTimeout(t);
      clearTimeout(f);
      if (journeyTimer) clearTimeout(journeyTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // Selection. An empty string means "nothing selected on purpose".
  const selectedId = selected === "" ? null : selected ?? triage?.items[0]?.household ?? null;
  const household = snap?.households.find((h) => h.id === selectedId) ?? null;
  const incident =
    snap?.incidents
      .filter((i) => i.household === selectedId && i.status !== "resolved")
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1))[0] ?? null;
  const ranked = triage?.items.find((r) => r.household === selectedId) ?? null;
  const trail = (selectedId && snap?.trail[selectedId]) || [];
  const needIds = (household?.needs ?? []).map((n) => n.id);
  const guidance = guidanceForNeeds(needIds);
  const journeyHops = useMemo(
    () => (selectedId && snap ? journeyHopsFor(snap, selectedId) : []),
    [selectedId, snap],
  );
  const journeyCrumb = journeyHops.length ? formatJourneyBreadcrumb(journeyHops) : "";
  const showJourney = journeyHops.length > 0;

  useEffect(() => {
    cityRef.current?.select(selectedId);
  }, [selectedId, snap]);

  const act = useCallback(
    async (kind: "ok" | "ack") => {
      if (!household) return;
      try {
        const result = await post("/api/actions", { kind, household: household.id, incident: incident?.key });
        if (kind === "ack" && result.already) showToast(`Help is already on the way to ${household.label}`);
        else showToast(kind === "ok" ? `${household.label} marked safe` : `Someone is on the way to ${household.label}`);
      } catch (err) {
        showToast((err as Error).message);
      }
    },
    [household, incident, showToast],
  );

  const toggleOutage = async () => {
    try {
      await post("/api/outage", { down: !snap?.outage });
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const toggleEmergency = async () => {
    if (emergencyBusyRef.current) return;
    emergencyBusyRef.current = true;
    try {
      await post("/api/emergency", { active: !snap?.emergencySince });
      showToast(snap?.emergencySince ? "Emergency ended" : "Emergency declared");
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      emergencyBusyRef.current = false;
    }
  };

  const sendSomeone = useCallback(
    async (householdId: string, label: string, note?: string) => {
      try {
        const result = await post("/api/actions", {
          kind: "ack",
          household: householdId,
          ...(note ? { note } : {}),
        });
        if (result.already) showToast(`Help is already on the way to ${label}`);
        else showToast(`Someone is on the way to ${label}`);
        void refreshTriage();
      } catch (err) {
        showToast((err as Error).message);
      }
    },
    [showToast, refreshTriage],
  );

  const sendSomeoneSilent = useCallback(
    async (householdId: string, label: string, minutesSilent: number) => {
      await sendSomeone(householdId, label, `Proactive wellness check: not heard from for ${minutesSilent} minutes`);
    },
    [sendSomeone],
  );

  const runDemoReset = async () => {
    if (demoResetBusyRef.current || resetBusy) return;
    demoResetBusyRef.current = true;
    setResetBusy(true);
    try {
      await post("/api/demo/reset", {});
      setResetConfirm(false);
      showToast("Demo reset. Every call, reply and notice is cleared.");
      void refreshTriage();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      demoResetBusyRef.current = false;
      setResetBusy(false);
    }
  };

  const loadPreflight = async () => {
    setPreflightLoading(true);
    try {
      const r = await fetch("/api/preflight", { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.reason ?? `Preflight failed (${r.status})`);
      setPreflightChecks(data.checks ?? []);
    } catch (err) {
      setPreflightChecks([{ name: "preflight", ok: false, detail: (err as Error).message }]);
    } finally {
      setPreflightLoading(false);
    }
  };

  // Keyboard shortcuts for a coordinator working fast: J and K move, C calls, V talks to Porchlight, D dispatches, S marks safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const items = triage?.items ?? [];
      const idx = items.findIndex((r) => r.household === selectedId);
      const key = e.key.toLowerCase();
      if (demoResetEnabled && e.shiftKey && key === "r") {
        setResetConfirm(true);
        e.preventDefault();
        return;
      }
      if (key === "p" && !e.shiftKey) {
        setPreflightOpen((open) => {
          const next = !open;
          if (next) void loadPreflight();
          return next;
        });
        e.preventDefault();
        return;
      }
      if (key === "n" && !e.shiftKey) {
        setNoticesOpen((o) => !o);
        e.preventDefault();
        return;
      }
      if (key === "j" && items.length) choose(items[Math.min(items.length - 1, idx + 1)]!.household);
      else if (key === "k" && items.length) choose(items[Math.max(0, idx - 1)]!.household);
      else if (key === "c" && household && !copilotBusy && !copilotOpen) {
        if (guidance.voiceCallSuitable) void startResidentCall(household.id, incident?.key ?? null);
        else void sendSomeone(household.id, household.label);
      }
      else if (key === "v" && copilot.available && !voiceBusy) void startCopilot();
      else if (key === "d" && incident?.status === "open") void act("ack");
      else if (key === "s" && household) void act("ok");
      else if (key === "escape") {
        if (resetConfirm) setResetConfirm(false);
        else if (noticesOpen) setNoticesOpen(false);
        else if (preflightOpen) setPreflightOpen(false);
        else if (copilotOpen) void copilot.end();
        else {
          setSelected("");
          cityRef.current?.focus("ops");
        }
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    triage,
    selectedId,
    household,
    incident,
    voiceBusy,
    copilotBusy,
    copilotOpen,
    copilot.available,
    copilot.end,
    act,
    choose,
    startCopilot,
    startResidentCall,
    sendSomeone,
    guidance.voiceCallSuitable,
    demoResetEnabled,
    resetConfirm,
    preflightOpen,
    noticesOpen,
  ]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const cityHouseholds = useMemo(() => {
    const silentIds = new Set((snap?.silent ?? []).map((s) => s.household));
    return (snap?.households ?? []).map((h) => ({
      id: h.id,
      label: h.label,
      status: (silentIds.has(h.id) && !h.openIncident ? "silent" : h.status) as "unknown" | "ok" | "help" | "acknowledged" | "silent",
      lights: (h.lightState === "on" || h.lightState === "off" ? h.lightState : undefined) as "on" | "off" | undefined,
    }));
  }, [snap]);

  const counts = useMemo(() => {
    const c = { help: 0, acknowledged: 0, ok: 0, unknown: 0 };
    for (const h of snap?.households ?? []) c[h.status as keyof typeof c] += 1;
    return c;
  }, [snap]);
  const silentCount = snap?.silent?.length ?? 0;
  const nodesFresh = (snap?.nodes ?? []).filter((n) => Date.now() - n.lastSeenAt < 15_000).length;
  const nodesTotal = Math.max(snap?.nodes.length ?? 0, nodeHouseIds.length);

  liveRef.current = {
    snap,
    triage,
    counts,
    nodesReporting: nodesFresh,
    nodesTotal,
  };

  const preflightSummary = summarizePreflight(preflightChecks ?? []);

  useEffect(() => {
    void copilot.checkAvailable();
    void loadPreflight();
    // Probe once on mount so the header button can disable with a tooltip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  const silentIds = new Set((snap?.silent ?? []).map((s) => s.household));
  const isSilent = (id: string) => silentIds.has(id) && !(snap?.households.find((h) => h.id === id)?.openIncident);
  const statusOf = (id: string, status: string) => (isSilent(id) ? "silent" : status);
  const STATUS_WORD: Record<string, string> = { ...STATUS_TEXT, silent: "Silent" };
  const emergencyMinutes = snap?.emergencySince ? Math.max(0, Math.floor((now - snap.emergencySince) / 60_000)) : null;
  const openCalls = triage?.items.length ?? 0;
  const drawerOpen = Boolean(household);
  const householdStatus = household ? statusOf(household.id, household.status) : "unknown";
  const signs = household?.signsOfLife ?? null;
  const voiceActive = voice.state !== "idle" || voice.lines.length > 0 || Boolean(voice.error);

  // Keep the home the camera looks at centred in the free space between the rail and the drawer.
  useEffect(() => {
    const apply = () => {
      const city = cityRef.current;
      if (!city) return;
      const w = window.innerWidth;
      if (w <= 980) {
        city.setSafeArea(0, 0);
        return;
      }
      const rail = w <= 1180 ? 320 : 356;
      const drawer = w <= 1180 ? 360 : 412;
      city.setSafeArea(rail + 28, drawerOpen ? drawer + 28 : 14);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [drawerOpen, snap === null]);

  const menuGroups: MenuGroup[] = [
    {
      id: "emergency",
      heading: "Emergency",
      items: [
        {
          id: "emergency",
          icon: <IconSiren />,
          tone: "porch",
          label: snap?.emergencySince ? "End the emergency" : "Declare an emergency",
          hint: snap?.emergencySince ? "Stops watching for silent homes" : "Starts watching for vulnerable homes that go silent",
          onSelect: () => void toggleEmergency(),
        },
        {
          id: "outage",
          icon: <IconUplink />,
          tone: "moon",
          label: snap?.outage ? "Restore the city link" : "Simulate a city outage",
          hint: snap?.outage ? "Nodes deliver everything they held" : "Nodes hold calls until the link returns",
          onSelect: () => void toggleOutage(),
        },
      ],
    },
    {
      id: "street",
      heading: "The street",
      items: [
        {
          id: "notices",
          icon: <IconMegaphone />,
          label: "Send a notice",
          hint: "In English and French, over the mesh",
          shortcut: "N",
          onSelect: () => setNoticesOpen(true),
        },
        {
          id: "preflight",
          icon: <IconGauge />,
          label: "Preflight checks",
          hint: preflightChecks
            ? preflightSummary.ok
              ? "All checks passed"
              : `${preflightSummary.passed} of ${preflightSummary.total} checks passed`
            : "Database, Gemini, voice, sign-in and nodes",
          shortcut: "P",
          onSelect: () => {
            setPreflightOpen(true);
            void loadPreflight();
          },
        },
        {
          id: "open311",
          icon: <IconFeed />,
          label: "Open311 feed",
          hint: "What the City's own systems read",
          href: "/api/open311/v2/requests.json",
          external: true,
        },
      ],
    },
    {
      id: "room",
      heading: "This room",
      items: [
        {
          id: "sound",
          icon: <IconSound on={sound} />,
          label: sound ? "Turn the arrival chime off" : "Turn the arrival chime on",
          onSelect: () => setSound((v) => !v),
        },
        { id: "story", icon: <IconFilm />, label: "Story mode", hint: "The guided tour for an audience", href: "/present" },
        ...(demoResetEnabled
          ? [
              {
                id: "reset",
                icon: <IconReset />,
                tone: "signal" as const,
                label: "Reset the demo",
                hint: "Clears every call, reply and notice",
                shortcut: "Shift R",
                onSelect: () => setResetConfirm(true),
              },
            ]
          : []),
        ...(authMode === "auth0" ? [{ id: "signout", icon: <IconExit />, label: "Sign out", href: "/auth/logout" }] : []),
      ],
    },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="ops" data-drawer={drawerOpen ? "open" : "closed"}>
        <section className="ops-city" aria-hidden="true">
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
                const links: { from: string; to: string }[] = [];
                for (const inc of snap.incidents) {
                  if (inc.status !== "open" || inc.tier !== "buddies") continue;
                  for (const b of inc.buddies ?? []) links.push({ from: b.id, to: inc.household });
                }
                c.setBuddyArcs(links);
                c.setDrift(true);
                c.focus("ops", 0);
                window.dispatchEvent(new Event("resize"));
              }}
            />
          ) : null}
        </section>
        <div className="ops-scrim" aria-hidden="true" />
        {arrival ? <div key={arrival.key} className="veil" aria-hidden="true" /> : null}

        <header className="cmd">
          <Brand href="/" />
          <span className="cmd-divider" aria-hidden="true" />
          <div className="cmd-state" role="status" aria-live="polite">
            <span className="cmd-fact">
              <span className="lamp" data-tone={snap?.emergencySince ? "porch" : "off"} data-live={String(Boolean(snap?.emergencySince))} aria-hidden="true" />
              {snap?.emergencySince ? (
                <span>
                  Emergency declared <strong>{emergencyMinutes === 0 ? "just now" : `${emergencyMinutes} min ago`}</strong>
                </span>
              ) : (
                <span>No emergency declared</span>
              )}
            </span>
            <span className="cmd-fact" data-tone={snap?.outage ? "down" : "up"}>
              <span className="lamp" data-tone={snap?.outage ? "off" : "moon"} aria-hidden="true" />
              {snap?.outage ? <span><strong>City link down.</strong> Nodes are holding calls.</span> : <span>City link up</span>}
            </span>
            <span className="cmd-fact">
              <span className="lamp" data-tone={nodesFresh === nodesTotal && nodesTotal > 0 ? "porch" : "off"} aria-hidden="true" />
              <span>
                <strong>{nodesFresh} of {nodesTotal}</strong> nodes reporting
              </span>
            </span>
          </div>
          <span className="cmd-spacer" />
          <div className="ledger" role="group" aria-label="The street at a glance">
            <span className="ledger-item" data-kind="help" data-zero={String(counts.help === 0)}><b>{counts.help}</b>need help</span>
            <span className="ledger-item" data-kind="acknowledged" data-zero={String(counts.acknowledged === 0)}><b>{counts.acknowledged}</b>on the way</span>
            <span className="ledger-item" data-kind="silent" data-zero={String(silentCount === 0)}><b>{silentCount}</b>silent</span>
            <span className="ledger-item" data-kind="ok" data-zero={String(counts.ok === 0)}><b>{counts.ok}</b>safe</span>
          </div>
          <button
            className="talk"
            type="button"
            aria-pressed={copilotBusy}
            disabled={!copilot.available || voiceBusy || copilot.state === "connecting"}
            title={!copilot.available ? "The copilot agent is not configured" : voiceBusy ? "End the resident call first" : "Talk to Porchlight (V)"}
            onClick={() => void startCopilot()}
          >
            <span className="orb" data-mode={copilot.state} aria-hidden="true" />
            Talk to Porchlight
            <kbd>V</kbd>
          </button>
          <CommandMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            groups={menuGroups}
            who={authMode === "local-open" ? `${coordinator}. Sign-in is off in local development; production requires Auth0.` : coordinator}
          />
        </header>

        {sessionEnded ? (
          <p className="banner banner-warn" role="alert">
            Your sign-in ended. <a href="/auth/login?returnTo=/ops">Sign in again</a>
          </p>
        ) : !connected ? (
          <p className="banner banner-warn" role="status" aria-live="polite">Reconnecting to the city server…</p>
        ) : null}

        <aside className="rail lantern" aria-label="Calls and homes">
          <div className="rail-scroll scroll-quiet">
            <section className="rail-section" aria-labelledby="queue-h">
              <div className="rail-head">
                <h1 id="queue-h" className="rail-title">
                  Who needs help first
                  <span className="rail-count">{openCalls ? `${openCalls} open` : ""}</span>
                </h1>
                <p className="rail-sub" data-source={triage?.source ?? "rules"}>
                  {triage?.source === "gemini"
                    ? `Ranked by Gemini (${triage.model}). Suggestions only: you decide.`
                    : triage?.note ?? "Ranked by the built-in rules."}
                </p>
              </div>
              {!snap ? (
                <div className="quiet" data-loading="true">
                  <span className="quiet-lamp" aria-hidden="true" />
                  <p className="quiet-title">Connecting to the city</p>
                  <p>Loading the street, the calls and the network.</p>
                </div>
              ) : triage && triage.items.length ? (
                <LayoutGroup>
                  <ol className="tickets">
                    <AnimatePresence initial={false}>
                      {triage.items.map((r, i) => {
                        const inc = snap?.incidents.find((x) => x.key === r.incident);
                        const status = inc?.status ?? "open";
                        const fall = isFall(inc?.note);
                        const shownNeeds = r.needs.slice(0, 3);
                        return (
                          <motion.li
                            key={r.incident}
                            layout="position"
                            initial={{ opacity: 0, x: -18 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -12, transition: { duration: 0.18 } }}
                            transition={{ type: "spring", stiffness: 420, damping: 38 }}
                          >
                            <button
                              type="button"
                              className="ticket"
                              data-new={String(fresh.has(r.incident))}
                              data-status={status}
                              aria-pressed={selectedId === r.household}
                              onClick={() => choose(r.household)}
                            >
                              <span className="ticket-rank">{i + 1}</span>
                              <span className="ticket-top">
                                <span className="ticket-name">{r.label}</span>
                                <span className="ticket-wait">{waited(r.waitMinutes)}</span>
                              </span>
                              <span className="ticket-reason">{sentence(r.reason)}</span>
                              <span className="tags">
                                {status === "acknowledged" ? <span className="tag" style={{ color: "var(--moon-hi)" }}>Help on the way</span> : null}
                                {fall ? <span className="tag tag-fall">Possible fall</span> : null}
                                {r.powerOut ? <span className="tag tag-power"><IconBolt />Power out</span> : null}
                                {r.tier && TIER_CHIP[r.tier] && status === "open" ? (
                                  <span className={TIER_CHIP[r.tier]!.className}>{TIER_CHIP[r.tier]!.text}</span>
                                ) : null}
                                {shownNeeds.map((n) => (
                                  <span key={n} className="tag">{n}</span>
                                ))}
                                {r.needs.length > shownNeeds.length ? <span className="tag">{r.needs.length - shownNeeds.length} more</span> : null}
                              </span>
                              <span className="ticket-meta">
                                {ACTION_TEXT[r.action]}. Speaks {r.lang === "fr" ? "French" : "English"}.
                              </span>
                            </button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ol>
                </LayoutGroup>
              ) : (
                <div className="quiet">
                  <span className="quiet-lamp" aria-hidden="true" />
                  <p className="quiet-title">All quiet on the street</p>
                  <p>
                    {nodesFresh} of {nodesTotal} nodes reporting. A call appears here the moment any node reaches the city.
                  </p>
                </div>
              )}
            </section>

            <section className="rail-section" aria-labelledby="silence-h">
              <div className="rail-head">
                <h2 id="silence-h" className="rail-title">
                  Haven&apos;t heard from
                  <span className="rail-count">{silentCount ? `${silentCount} silent` : ""}</span>
                </h2>
                <p className="rail-sub">
                  {snap?.emergencySince
                    ? silentCount
                      ? "Vulnerable homes with no sign of life since the emergency began."
                      : "Every vulnerable home has shown a sign of life, or has not been quiet long enough yet."
                    : "Declare an emergency to watch for vulnerable homes that go quiet."}
                </p>
              </div>
              {snap?.silent?.length ? (
                <ul className="hushes">
                  <AnimatePresence initial={false}>
                    {snap.silent.map((s) => {
                      const silentNeeds = (snap.households.find((h) => h.id === s.household)?.needs ?? []).map((n) => n.id);
                      const silentGuidance = guidanceForNeeds(silentNeeds);
                      return (
                        <motion.li
                          key={s.household}
                          layout="position"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, transition: { duration: 0.15 } }}
                          className="hush"
                        >
                          <button type="button" className="hush-main" onClick={() => choose(s.household)}>
                            <span className="hush-ring" aria-hidden="true" />
                            <span className="hush-name">{s.label}</span>
                            <span className="hush-time">{s.minutesSilent} min silent</span>
                          </button>
                          <span className="tags">
                            {s.powerOut ? <span className="tag tag-power"><IconBolt />Power out</span> : null}
                            {s.needs.slice(0, 3).map((n) => (
                              <span key={n} className="tag">{n}</span>
                            ))}
                          </span>
                          <div className="hush-actions">
                            {silentGuidance.voiceCallSuitable ? (
                              <>
                                <button
                                  className="btn btn-porch btn-small"
                                  type="button"
                                  onClick={() => {
                                    choose(s.household);
                                    void startResidentCall(s.household, null);
                                  }}
                                  disabled={voice.state === "connecting" || copilotBusy}
                                >
                                  <IconPhone />
                                  Check in {s.lang === "fr" ? "in French" : ""}
                                </button>
                                <button className="btn btn-small" type="button" onClick={() => void sendSomeoneSilent(s.household, s.label, s.minutesSilent)}>
                                  <IconWalk />
                                  Send someone
                                </button>
                              </>
                            ) : (
                              <>
                                <button className="btn btn-porch btn-small" type="button" onClick={() => void sendSomeone(s.household, s.label)}>
                                  <IconWalk />
                                  Send someone
                                </button>
                                <span className="hush-note">{silentGuidance.voiceUnsuitableNote}</span>
                              </>
                            )}
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              ) : null}
            </section>

            <section className="rail-section" aria-labelledby="street-h">
              <div className="rail-head">
                <h2 id="street-h" className="rail-title">
                  The street
                  <span className="rail-count">{snap ? `${snap.households.length} homes` : ""}</span>
                </h2>
                <p className="rail-sub">Every home on the map, in words.</p>
              </div>
              {!snap ? <p className="rail-sub">Loading homes…</p> : null}
              <ul className="street" aria-label="Street homes">
                {(snap?.households ?? []).map((h) => {
                  const st = statusOf(h.id, h.status);
                  const tone = st === "help" ? "signal" : st === "acknowledged" ? "moon" : st === "ok" ? "porch" : st === "silent" ? "hush" : "off";
                  return (
                    <li key={h.id}>
                      <button type="button" className="street-row" aria-pressed={selectedId === h.id} onClick={() => choose(h.id)}>
                        <span className="lamp" data-tone={tone} aria-hidden="true" />
                        <span className="street-name">{h.label}</span>
                        <span className="status-word" data-status={st}>{STATUS_WORD[st]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          <p className="rail-foot" aria-label="Keyboard shortcuts">
            <span><kbd>J</kbd><kbd>K</kbd> move</span>
            <span><kbd>C</kbd> call</span>
            <span><kbd>D</kbd> dispatch</span>
            <span><kbd>S</kbd> safe</span>
            <span><kbd>V</kbd> voice</span>
            <span><kbd>Esc</kbd> close</span>
          </p>
        </aside>

        <AnimatePresence>
          {household ? (
            <motion.aside
              key="drawer"
              className="drawer lantern"
              aria-labelledby="detail-h"
              initial={{ opacity: 0, x: 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 28, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 360, damping: 36 }}
            >
              <button className="btn btn-quiet btn-icon drawer-close" type="button" aria-label="Close this home" onClick={() => choose(null)}>
                <IconClose />
              </button>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={household.id}
                  className="drawer-scroll scroll-quiet"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="drawer-head">
                    <p className="drawer-status" data-status={householdStatus}>
                      <span
                        className="lamp"
                        data-tone={householdStatus === "help" ? "signal" : householdStatus === "acknowledged" ? "moon" : householdStatus === "ok" ? "porch" : householdStatus === "silent" ? "hush" : "off"}
                        data-live={String(householdStatus === "help")}
                        aria-hidden="true"
                      />
                      {STATUS_WORD[householdStatus]}
                      {incident && isFall(incident.note) ? ", possible fall" : ""}
                    </p>
                    <h2 id="detail-h" className="drawer-name">{household.label}</h2>
                    <p className="drawer-heard">
                      {household.lastEventAt ? `Last heard ${ago(household.lastEventAt)}` : "Not heard from yet"}
                      {incident
                        ? `. Heard by ${incident.witnesses.length} ${incident.witnesses.length === 1 ? "node" : "nodes"}, ${incident.waitMinutes < 1 ? "called just now" : `waiting ${incident.waitMinutes} min`}.`
                        : "."}
                    </p>
                    {household.needs.length || household.powerOut ? (
                      <div className="tags">
                        {household.powerOut ? <span className="tag tag-power"><IconBolt />Power out</span> : null}
                        {household.needs.map((n) => (
                          <span key={n.id} className="tag">{n.label}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="block-sub">No needs recorded.</p>
                    )}
                  </div>

                  <Vitals signs={signs} powerOut={Boolean(household.powerOut)} now={now} />

                  {ranked ? (
                    <div className="why">
                      <span className="why-label">{triage?.source === "gemini" ? "Why Gemini ranked this home here" : "Why this home is ranked here"}</span>
                      <p>{sentence(ranked.reason)}</p>
                    </div>
                  ) : null}
                  {incident?.note && !isFall(incident.note) ? (
                    <div className="why">
                      <span className="why-label">Note from the home</span>
                      <p>{incident.note}</p>
                    </div>
                  ) : null}

                  <div className="drawer-actions">
                    {guidance.voiceCallSuitable ? (
                      <button
                        className="btn btn-porch"
                        type="button"
                        onClick={() => void startResidentCall(household.id, incident?.key ?? null)}
                        disabled={voice.state === "connecting" || copilotBusy}
                      >
                        <IconPhone />
                        {voice.state === "idle" || voice.state === "error" ? `Call in ${household.lang === "fr" ? "French" : "English"}` : "Calling…"}
                        <kbd>C</kbd>
                      </button>
                    ) : (
                      <button className="btn btn-porch" type="button" onClick={() => void sendSomeone(household.id, household.label)}>
                        <IconWalk />
                        Send someone
                        <kbd>C</kbd>
                      </button>
                    )}
                    <button className="btn btn-moon" type="button" onClick={() => act("ack")} disabled={!incident || incident.status !== "open"}>
                      Dispatch <kbd>D</kbd>
                    </button>
                    <button className="btn" type="button" onClick={() => act("ok")}>
                      <IconCheck />
                      Mark safe <kbd>S</kbd>
                    </button>
                  </div>
                  {!guidance.voiceCallSuitable ? <p className="drawer-note">{guidance.voiceUnsuitableNote}</p> : null}

                  {guidance.lines.length ? (
                    <section className="block" aria-labelledby="bring-h">
                      <h3 id="bring-h" className="block-title">What to bring</h3>
                      <ul className="bring">
                        {guidance.lines.map((line) => (
                          <li key={line}>
                            <IconCheck />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {voiceActive ? (
                    <section className="block" aria-labelledby="voice-h">
                      <h3 id="voice-h" className="block-title">Voice check-in</h3>
                      <p className="voice-state" data-live={String(["speaking", "listening", "playing"].includes(voice.state))}>
                        <span className="lamp" data-tone={["speaking", "listening", "playing"].includes(voice.state) ? "porch" : "off"} data-live={String(voice.state === "listening")} aria-hidden="true" />
                        {{ idle: "Call ended.", connecting: "Connecting…", speaking: "Porchlight is speaking", listening: "Listening to the resident", playing: "Playing the opening line", error: voice.error ?? "The call failed." }[voice.state]}
                      </p>
                      {voice.lines.length ? (
                        <ol className="transcript scroll-quiet" aria-live="polite">
                          {voice.lines.map((l, i) => (
                            <li key={i} className="line" data-who={l.who}>{l.text}</li>
                          ))}
                        </ol>
                      ) : null}
                      <div className="row" style={{ display: "flex", gap: "var(--s-2)" }}>
                        {voice.state === "error" && guidance.voiceCallSuitable ? (
                          <button className="btn btn-porch btn-small" type="button" onClick={() => void startResidentCall(household.id, incident?.key ?? null)}>
                            Try again
                          </button>
                        ) : null}
                        {voice.state !== "idle" ? (
                          <button className="btn btn-small" type="button" onClick={() => void voice.end()}>End call</button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {incident ? (
                    <section className="block" aria-labelledby="neighbours-h">
                      <h3 id="neighbours-h" className="block-title">Neighbours</h3>
                      <p className="block-sub">
                        {incident.buddies?.length ? `Buddies: ${incident.buddies.map((b) => b.label).join(" and ")}.` : "No buddies recorded for this home."}
                      </p>
                      {incident.neighbourThread?.length ? (
                        <ol className="thread">
                          {incident.neighbourThread.map((r, i) => (
                            <li key={`${r.atMs}-${i}`}>
                              <span className="thread-who">{r.actorLabel}</span>
                              <span className="thread-what">{r.replyLabel}{r.note ? `: ${r.note}` : ""}</span>
                              <span className="thread-when">{clock(r.atMs)}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="block-sub">No replies yet.</p>
                      )}
                    </section>
                  ) : null}

                  {showJourney ? (
                    <section className="block" aria-labelledby="journey-h">
                      <h3 id="journey-h" className="block-title">The call&apos;s journey</h3>
                      <JourneyChain hops={journeyHops} />
                      <p className="visually-hidden">{journeyCrumb}</p>
                      <div>
                        <button className="btn btn-quiet btn-small" type="button" onClick={() => selectedId && playJourneyFor(selectedId)}>
                          <IconReplay />
                          Replay on the map
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {trail.length ? (
                    <section className="block" aria-labelledby="trail-h">
                      <h3 id="trail-h" className="block-title">How this reached you</h3>
                      <ol className="trail">
                        {trail.map((t) => (
                          <li key={t.id} data-kind={t.kind}>
                            <span className="trail-time">{clock(t.at)}</span>
                            <span className="trail-body">
                              <strong>
                                {t.kind === "reply"
                                  ? `Neighbour: ${t.note ?? "reply"}`
                                  : t.kind === "alive"
                                    ? aliveTrailLabel(t.signal)
                                    : t.kind === "help" && isFall(t.note ?? undefined)
                                      ? "Possible fall"
                                      : KIND_TEXT[t.kind] ?? t.kind}
                              </strong>
                              <span>
                                Signed by {t.by}
                                {t.source === "beacon" && t.beacon ? ` from beacon ${t.beacon}` : ""}.{" "}
                                {t.by === "the city"
                                  ? "Created in this room."
                                  : t.via
                                    ? t.via === t.by
                                      ? `Delivered by ${t.via}.`
                                      : `Relayed to the city by ${t.via}.`
                                    : "Loaded from storage."}
                              </span>
                              <span className="verified">
                                <IconShield />
                                Signature verified
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <section className="pulse lantern" aria-label="Network health">
          <Timeline buckets={snap?.timeline.buckets ?? []} source={snap?.timeline.source ?? "memory"} />
          <div className="pulse-stats">
            {snap && snap.holdSeconds.n > 0 ? (
              <>
                <span>
                  <b>{snap.holdSeconds.p50} s</b>
                  typical hold offline
                </span>
                <span>
                  <b>{snap.holdSeconds.p95} s</b>
                  slowest 5%
                </span>
              </>
            ) : (
              <span>
                <b>Nothing held</b>
                offline so far
              </span>
            )}
            <span>
              <b>{snap?.counts.events ?? 0}</b>
              in {snap?.storage === "tiger-data" ? "Tiger Data" : "memory"}
            </span>
          </div>
          <ul className="pulse-nodes" aria-label="Nodes">
            {(snap?.nodes ?? []).map((n) => {
              const freshNode = now - n.lastSeenAt < 15_000;
              return (
                <li key={n.id} className="node-lamp" title={`${n.name}: ${n.delivered} delivered, ${ago(n.lastSeenAt)}`}>
                  <span className="lamp" data-tone={freshNode ? "porch" : "off"} aria-hidden="true" />
                  <b>{n.name.replace(/^node-/, "")}</b>
                  <span className="visually-hidden">{`${n.name}: ${n.delivered} delivered, last seen ${ago(n.lastSeenAt)}`}</span>
                  <span aria-hidden="true">{n.delivered}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="center-lane lane-top">
          <AnimatePresence>
            {arrival ? (
              <motion.button
                key={arrival.key}
                type="button"
                className="arrival"
                data-fall={String(arrival.fall)}
                onClick={() => choose(arrival.household)}
                role="alert"
                aria-live="assertive"
                initial={{ opacity: 0, y: -24, scale: 0.94, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.25 } }}
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
              >
                <span className="arrival-beacon" aria-hidden="true" />
                <span>
                  <span className="arrival-kicker">{arrival.fall ? "Possible fall detected" : "New call for help"}</span>
                  <span className="arrival-name" style={{ display: "block" }}>{arrival.label}</span>
                </span>
                <span className="arrival-keys">
                  {guidanceForNeeds((snap?.households.find((h) => h.id === arrival.household)?.needs ?? []).map((n) => n.id)).voiceCallSuitable ? (
                    <span><kbd>C</kbd> call</span>
                  ) : (
                    <span><kbd>C</kbd> send someone</span>
                  )}
                  <span><kbd>D</kbd> dispatch a neighbour</span>
                </span>
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="center-lane lane-bottom" style={{ flexDirection: "column", alignItems: "center", gap: "var(--s-3)" }}>
          <AnimatePresence>
            {copilotOpen ? (
              <motion.div
                key="capsule"
                className="capsule lantern"
                role="dialog"
                aria-label="Hey Porchlight"
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              >
                <span className="orb orb-lg" data-mode={copilot.state} aria-hidden="true" />
                <div className="capsule-body">
                  <p className="capsule-title">Hey Porchlight</p>
                  <p className="capsule-state" data-mode={copilot.state}>
                    {{
                      idle: "Ready",
                      connecting: "Connecting…",
                      speaking: "Speaking",
                      listening: "Listening",
                      error: copilot.error ?? "Something went wrong",
                    }[copilot.state]}
                  </p>
                  {copilot.lines.length ? (
                    <ol className="transcript scroll-quiet" aria-live="polite">
                      {copilot.lines.slice(-4).map((l, i) => (
                        <li key={i} className="line" data-who={l.who}>{l.text}</li>
                      ))}
                    </ol>
                  ) : copilot.state !== "error" ? (
                    <p className="capsule-hint">Try &ldquo;who needs help first&rdquo; or &ldquo;show me Maple Crescent&rdquo;.</p>
                  ) : null}
                  {copilot.state === "error" ? (
                    <div className="capsule-actions">
                      <button className="btn btn-porch btn-small" type="button" onClick={() => void startCopilot()}>Try again</button>
                    </div>
                  ) : null}
                </div>
                <button className="btn btn-quiet btn-small" type="button" onClick={() => void copilot.end()}>End</button>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {notice ? (
              <motion.p
                key={notice}
                className="toast"
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <IconInfo />
                {notice}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        <NoticesPanel
          ref={(api) => {
            noticesApiRef.current = api;
          }}
          open={noticesOpen}
          onOpenChange={setNoticesOpen}
          notices={snap?.notices ?? []}
          onSent={() => {
            cityRef.current?.announceNotice();
            showToast("Notice sent to the street");
            void refreshTriage();
          }}
        />

        <AnimatePresence>
          {preflightOpen ? (
            <motion.div
              key="preflight"
              className="sheet preflight-sheet lantern"
              role="dialog"
              aria-label="Preflight checks"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 460, damping: 36 }}
            >
              <div className="sheet-head">
                <h2 className="sheet-title">Preflight</h2>
                <button className="btn btn-quiet btn-icon" type="button" aria-label="Close preflight" onClick={() => setPreflightOpen(false)}>
                  <IconClose />
                </button>
              </div>
              {preflightLoading && !preflightChecks ? (
                <p className="sheet-sub">Checking…</p>
              ) : (
                <ul className="checks">
                  {(preflightChecks ?? []).map((c) => (
                    <li key={c.name} className="check">
                      <span className="lamp" data-tone={c.ok ? "porch" : "signal"} aria-hidden="true" />
                      <span>
                        <strong>{c.name}: {c.ok ? "ready" : "needs attention"}</strong>
                        <span>{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="sheet-sub">
                {preflightChecks ? (preflightSummary.ok ? "All checks passed." : `${preflightSummary.passed} of ${preflightSummary.total} checks passed.`) : null}{" "}
                The <a href="/api/open311/v2/requests.json" target="_blank" rel="noopener noreferrer">Open311 feed</a> is what the City&apos;s systems read.
              </p>
              <div className="row">
                <button className="btn btn-small" type="button" onClick={() => void loadPreflight()} disabled={preflightLoading}>
                  Check again
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {resetConfirm ? (
            <>
              <motion.div key="reset-scrim" className="scrim-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setResetConfirm(false)} />
              <motion.div
                key="reset"
                className="sheet reset-sheet lantern"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="demo-reset-h"
                initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-46%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.97, x: "-50%", y: "-48%", transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <h2 id="demo-reset-h" className="sheet-title">Reset the demo?</h2>
                <p className="sheet-sub">This clears every call, reply and notice, on the city and on the street.</p>
                <div className="row">
                  <button className="btn btn-signal" type="button" onClick={() => void runDemoReset()} disabled={resetBusy} autoFocus>
                    {resetBusy ? "Resetting…" : "Reset the demo"}
                  </button>
                  <button className="btn btn-quiet" type="button" onClick={() => setResetConfirm(false)} disabled={resetBusy}>
                    Keep everything
                  </button>
                </div>
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>

        <div role="status" aria-live="polite" className="visually-hidden">{notice}</div>
      </div>
    </MotionConfig>
  );
}
