// Porchlight stage autopilot.
// One press of the real beacon starts the show. The screen runs itself: it switches views,
// glides a cursor, clicks the coordinator's buttons and spotlights what the speaker is
// talking about. It never fakes an event: everything that happens in the world (the press,
// the neighbour's reply, the fall, the mug, the spoken command) is done by a person, and
// the autopilot waits for it by watching the real system.

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
const CITY = process.env.STAGE_CITY ?? "https://leavethelighton.casa";
const NODE = process.env.STAGE_NODE ?? "http://localhost:7401";
const CHANNEL = process.env.STAGE_CHANNEL ?? "chrome"; // "chrome" drives the installed Chrome; set it empty for Playwright's Chromium
const HOUSE = "hh-maple-12";
const LABEL = "12 Maple Crescent";
const REHEARSE = process.argv.includes("--rehearse");
const SPEED = REHEARSE ? 0.5 : 1;

/* Terminal output: the team's cue sheet */

const C = { dim: "\x1b[2m", bold: "\x1b[1m", amber: "\x1b[33m", red: "\x1b[31m", blue: "\x1b[36m", green: "\x1b[32m", off: "\x1b[0m" };
const t0 = { at: 0 };
const clock = () => {
  if (!t0.at) return "  00:00";
  const s = Math.floor((Date.now() - t0.at) / 1000);
  return `  ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const say = (msg) => console.log(`${C.dim}${clock()}${C.off}  ${msg}`);
const cue = (who, msg) => console.log(`${C.dim}${clock()}${C.off}  ${C.bold}${C.amber}${who.toUpperCase()}${C.off}  ${msg}`);
const warn = (msg) => console.log(`${C.dim}${clock()}${C.off}  ${C.red}${msg}${C.off}`);

/* Presenter controls, from the projector window or the terminal */

const control = { paused: false, skip: false, fallback: false, quit: false };
function onKey(k) {
  if (k === " ") {
    control.paused = !control.paused;
    say(control.paused ? `${C.blue}Paused. Space to resume.${C.off}` : `${C.blue}Resumed.${C.off}`);
  } else if (k === "arrowright") {
    control.skip = true;
    say(`${C.blue}Skipping this wait.${C.off}`);
  } else if (k === "f") {
    control.fallback = true;
  } else if (k === "q") {
    control.quit = true;
  }
}
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (str, key) => {
    if (key?.ctrl && key.name === "c") process.exit(0);
    if (key?.name === "space") onKey(" ");
    else if (key?.name === "right") onKey("arrowright");
    else if (key?.name === "f") onKey("f");
    else if (key?.name === "q") onKey("q");
    else if (key?.name === "return") enterWaiters.splice(0).forEach((r) => r());
  });
}
const enterWaiters = [];
const waitEnter = () => new Promise((r) => enterWaiters.push(r));

class Quit extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimum hold: counts only while not paused, and ends early on a skip. */
async function hold(ms) {
  let left = ms * SPEED;
  while (left > 0) {
    if (control.quit) throw new Quit();
    if (control.skip) {
      control.skip = false;
      return;
    }
    await sleep(100);
    if (!control.paused) left -= 100;
  }
}

/** Wait for a real event. Never gives up on its own; the presenter can skip, or use the fallback if one exists. */
async function waitFor(what, test, { fallback, warnAfter = 25000 } = {}) {
  const start = Date.now();
  let warned = false;
  say(`${C.dim}waiting for ${what}${C.off}`);
  for (;;) {
    if (control.quit) throw new Quit();
    if (control.skip) {
      control.skip = false;
      say(`${C.blue}Skipped: ${what}${C.off}`);
      return "skipped";
    }
    if (control.fallback) {
      control.fallback = false;
      if (fallback) {
        warn(`FALLBACK USED: ${what}`);
        await fallback();
      } else warn("No fallback for this step. Right arrow skips it.");
    }
    try {
      if (!control.paused && (await test())) return "ok";
    } catch {
      /* the page may be mid navigation; try again */
    }
    if (!warned && Date.now() - start > warnAfter) {
      warned = true;
      warn(`Still waiting for ${what}. Right arrow skips it${fallback ? ", F uses the fallback" : ""}.`);
    }
    await sleep(250);
  }
}

/* The real system */

async function nodeState() {
  const r = await fetch(`${NODE}/api/state`, { cache: "no-store" });
  if (!r.ok) throw new Error(`node state ${r.status}`);
  return r.json();
}
const mapleIncidents = (s) => (s.incidents ?? []).filter((i) => i.household === HOUSE);
const isFallNote = (note) => typeof note === "string" && note.startsWith("Possible fall");

/* The stage browser */

const log = { startedAt: new Date().toISOString(), rehearse: REHEARSE, beats: [] };
let beatStart = 0;
function beat(n, who, title) {
  const now = Date.now();
  if (log.beats.length) log.beats[log.beats.length - 1].seconds = Math.round((now - beatStart) / 100) / 10;
  beatStart = now;
  log.beats.push({ beat: n, who, title, startedAt: t0.at ? Math.round((now - t0.at) / 1000) : 0 });
  console.log("");
  cue(who, `${C.bold}Beat ${n}: ${title}${C.off}`);
}

async function main() {
  console.log(`${C.bold}Porchlight stage autopilot${C.off}${REHEARSE ? "  (rehearsal: holds halved)" : ""}`);
  console.log(`${C.dim}Space pauses, right arrow skips a wait, F uses the fallback, Q quits. Park the real mouse in a corner.${C.off}\n`);

  const context = await chromium.launchPersistentContext(join(HERE, ".profile"), {
    headless: false,
    channel: CHANNEL || undefined,
    viewport: null,
    bypassCSP: true,
    args: ["--start-fullscreen", "--autoplay-policy=no-user-gesture-required", "--disable-infobars"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  await context.grantPermissions(["microphone"], { origin: CITY });
  await context.addInitScript({ content: readFileSync(join(HERE, "overlay.js"), "utf8") });
  await context.exposeBinding("__stageKey", (_source, k) => onKey(k));

  const [first] = context.pages();
  const landing = first ?? (await context.newPage());
  const ops = await context.newPage();
  const node = await context.newPage();

  /* Helpers that act on a page */

  const stage = (page, fn, arg) => page.evaluate(fn, arg).catch(() => {});
  async function show(page) {
    await stage(page, () => window.__stage?.cover(1, 0));
    await page.bringToFront();
    await sleep(120);
    await stage(page, () => window.__stage?.cover(0, 260));
    await sleep(280);
  }
  async function centreOf(locator) {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    const box = await locator.first().boundingBox({ timeout: 6000 });
    if (!box) throw new Error("target not visible");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }
  async function glide(page, locator, ms = 800) {
    const { x, y } = await centreOf(locator);
    await stage(page, () => window.__stage?.showCursor(true));
    await stage(page, ({ x, y, ms }) => window.__stage?.moveTo(x, y, ms), { x, y, ms });
    await sleep(ms + 60);
    return { x, y };
  }
  async function glideClick(page, locator, ms = 800) {
    await glide(page, locator, ms);
    await stage(page, () => window.__stage?.click());
    await locator.first().click({ timeout: 5000 });
    await sleep(250);
  }
  async function spotlight(page, locator, ms) {
    try {
      const { box } = await centreOf(locator);
      await stage(page, (r) => window.__stage?.spotlight(r), box);
      await hold(ms);
    } catch {
      warn("Could not find something to spotlight; carrying on.");
      await hold(ms);
    } finally {
      await stage(page, () => window.__stage?.spotlight(null));
    }
  }
  async function wheelTo(page, targetY, seconds) {
    // Gentle wheel steps, so the page's own smooth scrolling (Lenis) does the easing.
    const startY = await page.evaluate(() => window.scrollY);
    const distance = targetY - startY;
    if (Math.abs(distance) < 20) return;
    const steps = Math.max(8, Math.round(Math.abs(distance) / 90));
    const each = distance / steps;
    const pause = (seconds * 1000 * SPEED) / steps;
    const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await page.mouse.move(vp.width / 2, vp.height / 2);
    for (let i = 0; i < steps; i += 1) {
      if (control.quit) throw new Quit();
      while (control.paused) await sleep(100);
      await page.mouse.wheel(0, each);
      await sleep(pause);
    }
  }
  const sectionTop = (page, i) => page.evaluate((i) => {
    const s = document.querySelectorAll(".story-section")[i];
    return s ? s.offsetTop : 0;
  }, i);
  async function menu(label) {
    await glideClick(ops, ops.getByRole("button", { name: "Menu" }), 700);
    await sleep(350);
    await glideClick(ops, ops.getByRole("menuitem", { name: label }), 650);
  }
  const opsText = () => ops.locator(".cmd-state").innerText({ timeout: 3000 }).catch(() => "");

  /* Pre roll */

  say("Loading the operations room.");
  await ops.goto(`${CITY}/ops`, { waitUntil: "domcontentloaded" });
  if (!(await ops.locator(".cmd").count())) {
    await ops.bringToFront();
    warn("Sign in to the operations room in the stage browser (Auth0 and MFA). The show continues once the room loads.");
    await ops.waitForSelector(".cmd", { timeout: 10 * 60_000 });
  }
  await ops.waitForSelector(".rail", { timeout: 60_000 });
  await sleep(1500);

  say("Loading the node console (viewer only; the beacon stays connected in your own Chrome).");
  await node.goto(`${NODE}/`, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  const before = await nodeState().catch(() => null);
  if (!before) {
    warn(`The node at ${NODE} is not answering. Start the nodes, then run the autopilot again.`);
    await context.close();
    process.exit(1);
  }
  const openBefore = mapleIncidents(before).filter((i) => i.status !== "resolved");
  if (openBefore.length || (await ops.locator(".ticket").count())) {
    warn("A call is already open. Reset first (Shift+R in the ops room, then npm run demo:reset with the nodes stopped). Press Enter to continue anyway.");
    await waitEnter();
  }
  const knownKeys = new Set(mapleIncidents(before).map((i) => i.key));

  await ops.bringToFront();
  if (!(await opsText()).includes("Emergency declared")) {
    say("Declaring an emergency.");
    await menu("Declare an emergency");
    await sleep(800);
  }
  if (!(await opsText()).includes("City link down")) {
    say("Cutting the city link.");
    await menu("Simulate a city outage");
    await waitFor("the city link to go down", async () => (await opsText()).includes("City link down"), { warnAfter: 8000 });
  }
  // One click on the page so the arrival chime is allowed to play.
  const spacer = ops.locator(".cmd-spacer");
  if (await spacer.count()) await spacer.click({ force: true }).catch(() => {});
  await stage(ops, () => window.__stage?.showCursor(false));

  await landing.goto(CITY, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  await landing.evaluate(() => window.scrollTo(0, 0));
  await show(landing);
  await stage(landing, () => window.__stage?.showCursor(false));

  console.log("");
  console.log(`${C.bold}${C.green}Armed.${C.off} ${C.bold}Gautam: press the beacon on your first word.${C.off}`);

  /* The show */

  // Beat 1: the hook. The press starts everything.
  await waitFor("the beacon press to reach the street", async () => {
    const s = await nodeState();
    return mapleIncidents(s).some((i) => !knownKeys.has(i.key) && i.status !== "resolved");
  }, { fallback: () => node.locator('[data-sim="help"]').click().catch(() => {}) });
  t0.at = Date.now();
  beat(1, "Gautam", "the hook. The landing page plays itself.");
  const threeHomes = await sectionTop(landing, 3);
  await wheelTo(landing, threeHomes + 120, 24);
  await hold(Math.max(0, 32000 - (Date.now() - t0.at)) / SPEED);

  // Beat 2: neighbours first.
  beat(2, "Adam", "neighbours first. Adam clicks On my way.");
  await show(node);
  const card = node.locator(".alert", { hasText: LABEL });
  await spotlight(node, card.locator(".circle-banner"), 4500);
  await spotlight(node, card.locator(".what-to-bring"), 4000);
  await glide(node, card.getByRole("button", { name: "On my way" }), 800);
  cue("Adam", "click On my way now.");
  await waitFor("On my way from a neighbour", async () => {
    const s = await nodeState();
    return mapleIncidents(s).some((i) => !knownKeys.has(i.key) && (i.status === "acknowledged" || (i.replies ?? []).some((r) => r.reply === "omw")));
  }, {
    fallback: async () => {
      await stage(node, () => window.__stage?.click());
      await card.getByRole("button", { name: "On my way" }).first().click().catch(() => {});
    },
  });
  await stage(node, () => window.__stage?.click());

  // Beat 3: her light turns green.
  beat(3, "Adam", "her light turns green. Pradyumna holds up the beacon.");
  await hold(1500);
  await spotlight(node, node.locator(".house", { hasText: LABEL }), 5000);
  await stage(node, () => window.__stage?.showCursor(false));

  // Beat 4: the link returns.
  beat(4, "Abdul", "the link returns.");
  await show(ops);
  await menu("Restore the city link");
  await waitFor("the arrival banner", async () => (await ops.locator(".arrival").count()) > 0, { warnAfter: 15000 });
  await hold(3000);

  // Beat 5: the journey, the signatures, Gemini.
  beat(5, "Abdul", "the journey, the signatures, and Gemini's reason.");
  await stage(ops, () => window.__stage?.showCursor(false));
  await hold(6500);
  await spotlight(ops, ops.locator(".drawer .chain"), 6500);
  await spotlight(ops, ops.locator(".drawer .trail li").first(), 5000);
  await spotlight(ops, ops.locator(".drawer .why").first(), 7000);

  // Beat 6: the fall.
  beat(6, "Pradyumna", "the fall. Drop the beacon onto the towel.");
  await spotlight(ops, ops.locator(".drawer .vitals"), 4000);
  cue("Pradyumna", "drop the beacon now, and leave it still.");
  const fallStart = await nodeState().catch(() => before);
  const fallKnown = new Set(mapleIncidents(fallStart).filter((i) => isFallNote(i.note)).map((i) => i.key));
  await waitFor("the fall to reach the street", async () => {
    const s = await nodeState();
    return mapleIncidents(s).some((i) => isFallNote(i.note) && !fallKnown.has(i.key));
  }, { fallback: () => node.locator('[data-sim="fall"]').click().catch(() => {}) });

  // Beat 7: the City sees a possible fall.
  beat(7, "Pradyumna", "the City sees a possible fall.");
  await waitFor("the purple fall banner", async () => (await ops.locator('.arrival[data-fall="true"]').count()) > 0, { warnAfter: 12000 });
  await spotlight(ops, ops.locator(".arrival"), 5000);
  await spotlight(ops, ops.locator(".ticket .tag-fall").first(), 4500);

  // Beat 8: silence is a signal.
  beat(8, "Abdul", "silence is a signal. Then the mug.");
  await spotlight(ops, ops.locator(".rail-section", { has: ops.locator("#silence-h") }), 6500);
  cue("Pradyumna", "mug over the beacon now.");
  await waitFor("the power out tag", async () => (await ops.locator(".ticket .tag-power").count()) > 0 || (await ops.locator('.drawer .vital[data-alarm="true"]').count()) > 0, { warnAfter: 30000 });

  // Beat 9: she moves up the list.
  beat(9, "Abdul", "lights out at a home that needs power.");
  await spotlight(ops, ops.locator(".ticket .tag-power").first(), 4500);
  await spotlight(ops, ops.locator(".drawer .vital").nth(2), 4000);
  cue("Pradyumna", "lift the mug.");
  await waitFor("her lights to come back on", async () => {
    const t = await ops.locator(".drawer .vital").nth(2).innerText({ timeout: 2000 });
    return /\bOn\b/.test(t);
  }, { warnAfter: 30000 });

  // Beat 10: the voice.
  beat(10, "Gautam", "the voice copilot.");
  await glideClick(ops, ops.locator(".talk"), 800);
  await waitFor("the voice capsule", async () => (await ops.locator(".capsule").count()) > 0, { warnAfter: 10000 });
  await stage(ops, () => window.__stage?.showCursor(false));
  cue("Gautam", "say: Porchlight, who needs help first?");
  const voiceStart = Date.now();
  await waitFor("Porchlight to answer", async () => {
    const answered = (await ops.locator('.capsule .line[data-who="agent"]').count()) > 0;
    const state = await ops.locator(".capsule-state").innerText({ timeout: 1000 }).catch(() => "");
    return (answered && /Listening/.test(state)) || Date.now() - voiceStart > 25000;
  });
  await hold(Math.max(0, 18000 - (Date.now() - voiceStart)) / SPEED);

  // Beat 11: why it's real.
  beat(11, "Gautam", "why it's real: the proof.");
  const end = ops.locator(".capsule").getByRole("button", { name: "End" });
  if (await end.count()) await glideClick(ops, end, 600);
  await stage(ops, () => window.__stage?.showCursor(false));
  await stage(landing, () => window.__stage?.cover(1, 0));
  await landing.bringToFront();
  const proof = await sectionTop(landing, 11);
  await landing.evaluate((y) => window.scrollTo(0, y), Math.max(0, proof - 700));
  await sleep(900);
  await stage(landing, () => window.__stage?.cover(0, 400));
  await wheelTo(landing, proof + 260, 6);
  await hold(24000);

  // Beat 12: the close.
  beat(12, "Gautam", "the close. Q ends the show.");
  const last = await sectionTop(landing, 12);
  await wheelTo(landing, last + 80, 7);
  await stage(landing, () => window.__stage?.showCursor(false));
  while (!control.quit) await sleep(200);
  throw new Quit();
}

main()
  .catch((err) => {
    if (!(err instanceof Quit)) {
      warn(`The autopilot stopped: ${err?.message ?? err}`);
      warn("The browser stays open. Carry on by hand with the team script.");
    }
  })
  .finally(() => {
    if (log.beats.length) log.beats[log.beats.length - 1].seconds = Math.round((Date.now() - beatStart) / 100) / 10;
    log.totalSeconds = t0.at ? Math.round((Date.now() - t0.at) / 1000) : 0;
    try {
      mkdirSync(join(HERE, "logs"), { recursive: true });
      const file = join(HERE, "logs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, JSON.stringify(log, null, 2));
      console.log(`\n${C.dim}Timing log: ${file}${C.off}`);
      if (log.totalSeconds) console.log(`${C.bold}Total: ${Math.floor(log.totalSeconds / 60)} min ${log.totalSeconds % 60} s${C.off}`);
    } catch {
      /* nothing to save */
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  });
