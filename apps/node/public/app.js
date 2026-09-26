// Porchlight node console. No framework, no inline scripts, DOM built with textContent only.

let TOKEN = document.querySelector('meta[name="pl-token"]').content;
const FALL_NOTE = "Possible fall detected by the beacon. No button was pressed.";
const BLE = {
  service: "7a1f0001-5c3e-4f6b-9d2a-6c1e0b8f4a10",
  alert: "7a1f0002-5c3e-4f6b-9d2a-6c1e0b8f4a10",
  ack: "7a1f0003-5c3e-4f6b-9d2a-6c1e0b8f4a10",
  id: "7a1f0004-5c3e-4f6b-9d2a-6c1e0b8f4a10",
};

const PHRASES = {
  "help-received": {
    en: "Your call for help was received. Your neighbours have been notified.",
    fr: "Votre appel à l'aide a été reçu. Vos voisins ont été prévenus.",
  },
  "ok-received": {
    en: "Thank you. You're marked as safe.",
    fr: "Merci. Vous êtes indiqué comme étant en sécurité.",
  },
  "neighbour-alert": {
    en: "A neighbour needs help. Check the screen for the address.",
    fr: "Un voisin a besoin d'aide. Consultez l'écran pour l'adresse.",
  },
  "help-coming": {
    en: "A neighbour is on the way.",
    fr: "Un voisin est en route.",
  },
};

const REPLY_BUTTONS = [
  { code: "omw", label: "On my way", className: "btn btn-ack" },
  { code: "cant", label: "Can't go", className: "btn btn-quiet" },
  { code: "generator", label: "I have a generator", className: "btn btn-quiet" },
  { code: "blocked", label: "Road blocked", className: "btn btn-quiet" },
];

const STATUS_TEXT = {
  unknown: "Not heard from",
  ok: "Safe",
  help: "Needs help",
  acknowledged: "Help on the way",
};

const $ = (sel) => document.querySelector(sel);
let state = null;
let firstRender = true;
const seenIncidents = new Set();
const beacon = { mode: null, beaconId: null, device: null, ackChar: null, serialWriter: null };

// Helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, body, retried = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-porchlight-token": TOKEN },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !retried) {
    try {
      const s = await fetch("/api/session", { cache: "no-store" });
      const session = await s.json().catch(() => ({}));
      if (s.ok && session.token) {
        TOKEN = session.token;
        return api(path, body, true);
      }
    } catch { /* fall through to error below */ }
  }
  if (!res.ok && res.status !== 200) {
    const err = new Error(data.reason || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(message, tone = "info") {
  const t = $("#toast");
  t.textContent = message;
  t.dataset.tone = tone;
  t.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.dataset.show = "false"), 3800);
}

function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

const hlcWall = (hlc) => (hlc ? Number(hlc.split(".")[0]) : 0);
const bufToHex = (buf) => [...new Uint8Array(buf.buffer ?? buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBuf = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

// Voice

let voiceUnlocked = false;
let clips = { en: [], fr: [] };
fetch("/api/clips").then((r) => r.json()).then((c) => (clips = c)).catch(() => {});
document.addEventListener("pointerdown", () => (voiceUnlocked = true), { once: true });
document.addEventListener("keydown", () => (voiceUnlocked = true), { once: true });

function speak(key, lang = "en") {
  if (!voiceUnlocked) return;
  const text = PHRASES[key]?.[lang] ?? PHRASES[key]?.en;
  if (!text) return;
  const fallback = () => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "fr" ? "fr-CA" : "en-CA";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  // Prefer the pre-recorded ElevenLabs clip (works offline); fall back to the OS voice.
  if (clips[lang]?.includes(key)) new Audio(`/audio/${lang}/${key}.mp3`).play().catch(fallback);
  else fallback();
}

// Rendering

function renderUplink(u) {
  const box = $("#uplink");
  box.dataset.mode = u.mode;
  const title = $("#uplink-title");
  const sub = $("#uplink-sub");
  const btn = $("#uplink-toggle");
  btn.hidden = u.mode === "disabled";
  btn.textContent = u.mode === "cut" ? "Restore city link" : "Cut city link";
  const pending = u.pending === 1 ? "1 event waiting" : `${u.pending} events waiting`;
  switch (u.mode) {
    case "online":
      title.textContent = "Connected to the city";
      sub.textContent = u.pending ? `Sending ${pending}` : `Everything delivered, ${ago(u.lastOkAt)}`;
      break;
    case "cut":
      title.textContent = "City link cut";
      sub.textContent = `Working offline, ${pending}`;
      break;
    case "unreachable":
      title.textContent = "City unreachable";
      sub.textContent = `Retrying, ${pending}`;
      break;
    case "disabled":
      title.textContent = "No city link configured";
      sub.textContent = "This node works with neighbours only";
      break;
    default:
      title.textContent = "Connecting to the city";
      sub.textContent = pending;
  }
}

function renderStreet(households) {
  const list = $("#street");
  list.replaceChildren(
    ...households.map((h) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            class: "house",
            type: "button",
            dataset: { status: h.status },
            "aria-label": `${h.label}: ${STATUS_TEXT[h.status]}`,
            onclick: () => openSheet(h),
          },
          el(
            "span",
            { class: "house-shape", "aria-hidden": "true" },
            el("span", { class: "house-roof" }),
            el("span", { class: "house-body" }),
            el("span", { class: "house-window" }),
            el("span", { class: "house-porch" }),
          ),
          el("span", { class: "house-label" }, h.label),
          el("span", { class: "house-status" }, STATUS_TEXT[h.status]),
        ),
      ),
    ),
  );
}

function collapseAlerts(incidents) {
  const list = incidents.filter((i) => i.status !== "resolved");
  const best = new Map();
  const heard = new Map();
  const openKeys = new Map();
  const fall = new Map();
  const rank = (i) => (i.status === "open" ? 0 : 1);
  for (const inc of list) {
    const w = heard.get(inc.household) ?? new Set();
    for (const x of inc.witnesses) w.add(x);
    heard.set(inc.household, w);
    if (inc.status === "open") {
      const keys = openKeys.get(inc.household) ?? [];
      keys.push(inc.key);
      openKeys.set(inc.household, keys);
      if (inc.note === FALL_NOTE) fall.set(inc.household, true);
    }
    const cur = best.get(inc.household);
    if (!cur || rank(inc) < rank(cur) || (rank(inc) === rank(cur) && hlcWall(inc.openedAt) < hlcWall(cur.openedAt))) {
      best.set(inc.household, inc);
    }
  }
  return [...best.values()].map((i) => ({
    ...i,
    witnesses: [...(heard.get(i.household) ?? [])],
    openKeys: openKeys.get(i.household) ?? [],
    showFall: fall.get(i.household) === true,
  }));
}

function waitSeconds(i) {
  const opened = i.openedAtMs ?? hlcWall(i.openedAt);
  return Math.max(0, Math.round((Date.now() - opened) / 1000));
}

/** Porch Circles line on a call card. Null when the call is acknowledged (no tier). */
function circleBanner(i) {
  if (!i.tier) return null;
  if (i.tier === "buddies") {
    if (i.isBuddy) {
      return el("p", { class: "circle-banner circle-buddy" }, `You're a buddy for ${i.label}. They need you.`);
    }
    return el("p", { class: "circle-quiet" }, "Buddies alerted");
  }
  if (i.tier === "street") {
    return el("p", { class: "circle-banner circle-street" }, `No buddy has answered in ${waitSeconds(i)} s. Can anyone go?`);
  }
  if (i.tier === "city") {
    return el(
      "p",
      { class: "circle-banner circle-city" },
      `No neighbour has answered in ${waitSeconds(i)} s. The city has been alerted.`,
    );
  }
  return null;
}

function replyThread(replies) {
  if (!replies?.length) return null;
  return el(
    "ul",
    { class: "reply-thread" },
    ...replies.map((r) =>
      el(
        "li",
        {},
        el("strong", {}, r.actorLabel),
        el("span", {}, ` ${r.replyLabel}${r.note ? `: ${r.note}` : ""}`),
        el("span", { class: "reply-ago" }, ` · ${ago(r.atMs)}`),
      ),
    ),
  );
}

function renderAlerts(incidents) {
  const cards = collapseAlerts(incidents);
  $("#alerts-empty").hidden = cards.length > 0;
  $("#alerts").replaceChildren(
    ...cards.map((i) => {
      const heard = i.witnesses.length === 1 ? "Heard by 1 node" : `Heard by ${i.witnesses.length} nodes`;
      const acked = i.status === "acknowledged";
      const openedMs = i.openedAtMs ?? hlcWall(i.openedAt);
      return el(
        "li",
        { class: "alert", dataset: { status: i.status, tier: i.tier ?? "" } },
        circleBanner(i),
        el("p", { class: "alert-title" }, i.label),
        el("p", { class: "alert-meta" }, `${acked ? "A neighbour is on the way." : "Waiting for a neighbour."} ${heard}, ${ago(openedMs)}.`),
        i.showFall ? el("p", {}, "Possible fall, no button pressed") : i.note && i.note !== FALL_NOTE ? el("p", {}, i.note) : null,
        acked
          ? null
          : el(
              "div",
              { class: "row reply-row" },
              ...REPLY_BUTTONS.map((b) =>
                el("button", { class: b.className, type: "button", onclick: () => sendReply(i, b.code) }, b.label),
              ),
            ),
        replyThread(i.replies),
      );
    }),
  );

  // Announce alerts that arrived since the last render (not on first load).
  for (const i of cards) {
    if (!seenIncidents.has(i.key)) {
      seenIncidents.add(i.key);
      if (!firstRender && !i.witnesses.includes(state.node.id)) {
        const lang = state.households.find((h) => h.household === i.household)?.lang;
        speak("neighbour-alert", lang);
      }
    }
  }
}

function renderPeers(peers) {
  if (!peers.length) {
    $("#peers").replaceChildren(el("li", { class: "peer" }, "No neighbour nodes configured."));
    return;
  }
  $("#peers").replaceChildren(
    ...peers.map((p) => {
      const ok = p.lastOkAt && Date.now() - p.lastOkAt < 10_000 && !p.lastError;
      return el(
        "li",
        { class: "peer", dataset: { ok: String(Boolean(ok)) } },
        el("span", {}, p.url.replace(/^https?:\/\//, "")),
        el("span", { class: "peer-state" }, ok ? `in touch, ${p.rttMs} ms` : p.lastError ? p.lastError : "waiting"),
      );
    }),
  );
}

function renderLog(recent) {
  $("#log").replaceChildren(
    ...recent.map((e) =>
      el(
        "li",
        {},
        el("span", {}, new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })),
        el("span", { class: `log-kind-${e.kind}` }, e.kind),
        el("span", {}, `${e.label}, ${e.mine ? "this node" : `from ${e.origin.slice(0, 8)}`}, ${e.id.slice(0, 12)}`),
        el("span", { class: "log-up" }, e.uplinked ? "delivered" : "held"),
      ),
    ),
  );
}

function render(s) {
  state = s;
  $("#node-id").textContent = s.node.id.slice(0, 8);
  const home = $("#node-home");
  if (home) home.textContent = s.node.householdLabel ? `This node: ${s.node.householdLabel}` : "This node: not assigned";
  renderUplink(s.uplink);
  renderStreet(s.households);
  renderAlerts(s.incidents);
  renderPeers(s.peers);
  renderLog(s.recent);
  const chaos = Math.round(s.chaos.drop * 100);
  if (document.activeElement !== $("#chaos")) $("#chaos").value = String(chaos);
  $("#chaos-out").textContent = `${chaos}%`;
  $("#dev-row").hidden = !(s.dev.simulateBeacon && s.dev.beaconIds.length);
  firstRender = false;
}

// Actions

let sheetHousehold = null;
function openSheet(h) {
  sheetHousehold = h;
  $("#sheet-h").textContent = h.label;
  $("#sheet-status").textContent = `Currently: ${STATUS_TEXT[h.status]}`;
  $("#sheet-note").value = "";
  $("#house-sheet").showModal();
}

$("#house-sheet").addEventListener("close", async () => {
  const kind = $("#house-sheet").returnValue;
  if (!sheetHousehold || (kind !== "ok" && kind !== "help")) return;
  try {
    await api("/api/checkin", { household: sheetHousehold.household, kind, note: $("#sheet-note").value || undefined });
    toast(kind === "ok" ? `${sheetHousehold.label} marked safe` : `Help requested for ${sheetHousehold.label}`);
  } catch (err) {
    toast(err.message, "error");
  }
});

async function sendReply(card, code) {
  const keys = card.openKeys?.length ? card.openKeys : [card.key];
  try {
    for (const key of keys) {
      const r = await api("/api/reply", { incident: key, reply: code });
      if (r.ackFrame && beacon.beaconId && key.startsWith(`${beacon.beaconId}:`)) await sendAck(r.ackFrame);
    }
    const label = REPLY_BUTTONS.find((b) => b.code === code)?.label ?? code;
    toast(`${label}: ${card.label}`);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function acknowledge(card) {
  return sendReply(card, "omw");
}

$("#uplink-toggle").addEventListener("click", async () => {
  const cut = state?.uplink.mode !== "cut";
  try {
    await api("/api/uplink", { cut });
    toast(cut ? "City link cut. Neighbours keep talking." : "City link restored. Sending what we held.");
  } catch (err) {
    toast(err.message, "error");
  }
});

let chaosTimer;
$("#chaos").addEventListener("input", (e) => {
  $("#chaos-out").textContent = `${e.target.value}%`;
  clearTimeout(chaosTimer);
  chaosTimer = setTimeout(() => api("/api/chaos", { drop: Number(e.target.value) / 100 }).catch((err) => toast(err.message, "error")), 200);
});

for (const b of document.querySelectorAll("[data-sim]")) {
  b.addEventListener("click", async () => {
    const beaconId = state?.dev.beaconIds[0];
    if (!beaconId) return;
    try {
      const r = await api("/api/dev/beacon", { beaconId, kind: b.dataset.sim });
      onBeaconAccepted(r);
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// Beacon (Web Bluetooth + Web Serial)

function setBeaconStatus(text, connected) {
  const s = $("#beacon-status");
  s.textContent = text;
  s.dataset.connected = String(connected);
}

function onBeaconAccepted(r) {
  const lang = state?.households.find((h) => h.household === r.household)?.lang ?? "en";
  if (r.kind === "help") speak("help-received", lang);
  if (r.kind === "ok") speak("ok-received", lang);
  if (r.kind === "test") toast("Beacon test received");
}

async function relayFrame(beaconId, hex, via) {
  try {
    const r = await api("/api/beacon", { beaconId, frame: hex, via });
    if (r.ok) onBeaconAccepted(r);
  } catch (err) {
    if (err.data?.reason !== "duplicate") toast(`Beacon: ${err.message}`, "error");
  }
}

async function sendAck(hex) {
  try {
    if (beacon.mode === "ble" && beacon.ackChar) await beacon.ackChar.writeValueWithResponse(hexToBuf(hex));
    if (beacon.mode === "serial" && beacon.serialWriter) await beacon.serialWriter.write(`PLA1 ${hex}\n`);
  } catch (err) {
    toast(`Could not reach the beacon: ${err.message}`, "error");
  }
}

$("#connect-ble").addEventListener("click", async () => {
  if (!navigator.bluetooth) {
    toast("Bluetooth needs Chrome or Edge on a desktop. Try USB instead.", "error");
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE.service] }] });
    await attachBle(device);
  } catch (err) {
    if (err.name !== "NotFoundError") toast(err.message, "error");
  }
});

async function attachBle(device) {
  setBeaconStatus(`Connecting to ${device.name ?? "beacon"}…`, false);
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(BLE.service);
  let beaconId = null;
  try {
    const idChar = await svc.getCharacteristic(BLE.id);
    beaconId = new TextDecoder().decode(await idChar.readValue());
  } catch {
    beaconId = /pl-[a-z0-9-]+/.exec(device.name ?? "")?.[0] ?? null;
  }
  if (!beaconId) throw new Error("This device did not identify as a Porchlight beacon");
  const alertChar = await svc.getCharacteristic(BLE.alert);
  beacon.ackChar = await svc.getCharacteristic(BLE.ack);
  alertChar.addEventListener("characteristicvaluechanged", (e) => relayFrame(beaconId, bufToHex(e.target.value), "ble"));
  await alertChar.startNotifications();
  Object.assign(beacon, { mode: "ble", beaconId, device });
  setBeaconStatus(`Beacon ${beaconId} connected by Bluetooth`, true);
  device.addEventListener("gattserverdisconnected", () => reconnectBle(device), { once: true });
}

async function reconnectBle(device, attempt = 1) {
  setBeaconStatus(`Beacon ${beacon.beaconId} out of range. Reconnecting…`, false);
  try {
    await attachBle(device);
  } catch {
    if (attempt < 8) setTimeout(() => reconnectBle(device, attempt + 1), Math.min(15_000, 1000 * 2 ** attempt));
    else setBeaconStatus("Beacon lost. Press Connect to try again.", false);
  }
}

$("#connect-serial").addEventListener("click", async () => {
  if (!navigator.serial) {
    toast("USB connection needs Chrome or Edge on a desktop.", "error");
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(port.writable);
    beacon.serialWriter = encoder.writable.getWriter();
    beacon.mode = "serial";
    setBeaconStatus("Beacon connected by USB", true);
    readSerial(port);
  } catch (err) {
    if (err.name !== "NotFoundError") toast(err.message, "error");
  }
});

async function readSerial(port) {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const m = /^PLF1 (pl-[a-z0-9-]+) ([0-9a-f]{36})$/.exec(line);
        if (m) {
          beacon.beaconId = m[1];
          setBeaconStatus(`Beacon ${m[1]} connected by USB`, true);
          relayFrame(m[1], m[2], "serial");
        }
      }
    }
  } catch {
    setBeaconStatus("USB beacon disconnected.", false);
  }
}

// Live state

function connectStream() {
  const es = new EventSource("/api/stream");
  es.addEventListener("state", (e) => render(JSON.parse(e.data)));
  es.addEventListener("beacon-ack", (e) => {
    const msg = JSON.parse(e.data);
    if (beacon.beaconId && msg.beaconId === beacon.beaconId && msg.frame) void sendAck(msg.frame);
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectStream, 1500);
  };
}
connectStream();
setInterval(() => state && render(state), 1000);
