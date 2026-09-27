# Porchlight stage autopilot: brief for Claude Code

Build a **stage autopilot** for the live 5 minute pitch. The team talks; the screen runs itself. One press of the real beacon starts the show, and from then on the autopilot drives the projector: it switches between views, moves a visible cursor, clicks the coordinator's buttons, highlights what the speaker is talking about, and waits for the real events the team makes happen with the hardware.

Reuse the tooling you built for `video/` (Playwright, the smooth cursor, the event log) where it helps. Put this in `stage/`, with its own package.json (exact versions), a README, and `npm run stage` from the repo root. Do not commit profiles or logs; add them to .gitignore.

House rules: no double hyphens, em dashes or en dashes in any on screen text. Never print secrets. No browser extensions.

## The one rule: never fake an event

The autopilot automates only what a coordinator would click and what the audience should look at. Everything that happens in the world (the beacon press, the fall, the neighbour's reply, the mug over the beacon, the spoken voice command) is done by a person, for real. The autopilot waits for those events by watching the real system. If one does not arrive, it waits; it never simulates it unless a presenter presses the fallback key for that step.

## Architecture

- **A real, headed Chrome with the real GPU**, full screen on the projector. Use the same path you chose for the video (Windows side Chrome with `channel: "chrome"` if WSLg is not smooth). Persistent profile in `stage/.profile`, so the coordinator is already signed in to the operations room through Auth0 with MFA (sign in once by hand before the show; never type credentials).
- **Microphone permission** granted to https://leavethelighton.casa, because the voice copilot runs in this browser.
- **Three pages** in that browser: the landing page (https://leavethelighton.casa), the operations room (/ops), and the node console at http://localhost:7401 (19 Oak Terrace). "Switching view" means bringing a page to the front with a short crossfade (inject a full screen black overlay that fades out in 250 ms on the page being shown).
- **The beacon's Bluetooth connection stays in Gautam's normal Chrome**, not in the autopilot's browser. The autopilot's node console tab is a second viewer of the same node: it must never click Connect by Bluetooth or Connect by USB.
- **Watching the system:** poll the node's `GET http://localhost:7401/api/state` (same machine) every 250 ms and the City's state through the operations room page itself (read the DOM, or listen to its existing server sent events from inside the page). Decide on events from real data: a new incident for hh-maple-12, its status, a reply of type omw, a help event whose note is the fall note, an alive event with signal lights_off, and the copilot's state in the page.
- **The cursor:** inject the same smooth cursor into every page (a vector arrow with a soft shadow, spring smoothed), gliding from its last position to each target over 600 to 900 ms, with an amber click ripple. Click with Playwright at the target's centre after the glide, so the real button is really pressed.
- **The spotlight:** to point at something, dim the rest of the page to 55 percent with a soft edged cutout around the target element (an injected overlay with a large box shadow), fading in over 300 ms and out when the beat ends. No zoom on the live screen; the spotlight is the zoom.

## Controls (on the laptop keyboard, captured globally by the autopilot's window)

| Key | Action |
| - | - |
| Enter | Arm the show (runs the pre roll below), then wait for the beacon |
| Space | Pause or resume the timeline (waits keep watching) |
| Right arrow | Skip the current wait or hold and go to the next beat |
| F | Fallback for the current human step only, clearly: uses the node console's simulate button for the beacon steps, and prints "FALLBACK USED" in the terminal |
| Escape | Stop the autopilot and leave the browser where it is |

Print every beat to the terminal as it starts: its number, its speaker, and what it is waiting for. That terminal is the team's cue sheet.

## Pre roll (when Enter is pressed, before the audience sees anything)

1. Ops room: check that no call is open. If one is, stop and tell the team to reset.
2. Ops room, Menu: **Declare an emergency** if none is active (so the silent list fills within a minute), then **Simulate a city outage**.
3. Click once on the ops page so its arrival chime can play.
4. Bring the landing page to the front, scrolled to the top. Hide the cursor.
5. Terminal: "Armed. Press the beacon to start."

## The show

The first beacon event starts the timeline. Holds are minimums: a beat never ends before its hold, and never before the event it waits for.

| Beat | Speaker | Screen | Waits for | Hold |
| - | - | - | - | - |
| 1 | Gautam | Landing page. Play the story: scroll smoothly (Lenis is on the page; use gentle wheel steps) from the top through the derecho chapter, so the city goes dark and the page dims. Stop inside "Minutes later: Three homes still glow". | the beacon's help event reaching node-a (the start trigger) | 32 s |
| 2 | Adam | Crossfade to the node console. Glide the cursor to the call card for 12 Maple Crescent; spotlight the buddy banner, then "What to bring". Then glide to "On my way" and hover it, **but do not click**: Adam clicks it himself (or, if the node console is on the projector laptop, the cursor waits there for his click). | a reply of type omw from 19 Oak Terrace | 20 s |
| 3 | Adam | Stay on the node console. Spotlight the street: 12 Maple Crescent now reads "Help on the way". | 4 s after the reply (the beacon turns green in Pradyumna's hand) | 6 s |
| 4 | Abdul | Crossfade to the ops room. Glide to Menu, click it, glide to **Restore the city link**, click it. | the arrival banner (it will be the moonlight one) | 3 s |
| 5 | Abdul | Let the camera flight and journey play. Then spotlight the drawer's "The call's journey" chain, then the "Why ... ranked this home here" note, then the trail's "Signature verified" lines. | nothing | 26 s |
| 6 | Pradyumna | Stay on the ops room. Spotlight the Moved, Someone seen and Lights instruments. Terminal: "Pradyumna: drop the beacon now." (The beacon must be idle; with ACK_GREEN_SEC set to 20 on the beacon, it is idle again before this beat.) | a help event with the fall note for hh-maple-12 | 8 s |
| 7 | Pradyumna | Spotlight the purple "Possible fall detected" banner, then the ticket's "Possible fall" tag. | nothing | 12 s |
| 8 | Abdul | Scroll the rail to "Haven't heard from" and spotlight it. Terminal: "Pradyumna: mug over the beacon." | an alive event lights_off for hh-maple-12 | 10 s |
| 9 | Abdul | Spotlight the ticket's red "Power out" tag, then the Lights instrument reading "Out, needs power". Terminal: "Pradyumna: lift the mug." | an alive event lights_on | 8 s |
| 10 | Gautam | Glide to "Talk to Porchlight" and click it (it opens the voice copilot). Spotlight the voice capsule. Terminal: "Gautam: say 'Porchlight, who needs help first?'" | the copilot has spoken an answer and gone back to listening, or 25 s | 18 s |
| 11 | Gautam | Click End on the capsule. Crossfade to the landing page, jump to the "We tried to break it" proof chapter, scroll into it gently. | nothing | 30 s |
| 12 | Gautam | Scroll to the final chapter, "When the grid goes dark, the porch lights stay on." Hold. Hide the cursor. | nothing | until Escape |

Target total: 4 minutes 45 seconds, leaving 15 seconds of slack for real latencies.

## Configuration the team sets before the show (put this in stage/README.md too)

- Beacon firmware: `ACK_GREEN_SEC 20` in config.h, then flash. Twenty seconds of green is enough to see; after that the beacon is idle and can detect the fall in beat 6.
- Nodes and the City: `BUDDY_WINDOW_SEC=60` and `STREET_WINDOW_SEC=60`, so the buddy banner is still showing when beat 2 starts about 35 seconds in. The City reads these too: set them in the server's .env and redeploy.
- `SILENCE_MINUTES=1` stays as it is.

## Rehearsal mode

`npm run stage -- --rehearse` runs the same show with every hold shortened by half and prints the actual time of every beat, so the team can compare it against their speaking time. After each run, write `stage/logs/<time>.json` with each beat's start time, what it waited for and how long it actually waited.

## Done means

- A dry run from Enter to the final chapter, with real hardware, completes without touching the laptop except the beacon, the neighbour's click, the drop, the mug and the voice line.
- The cursor never teleports, every click lands on the real control, and nothing on screen shows an error, a dev overlay or a loading state.
- Report: which browser path was used, a sample terminal cue sheet from a run, and the measured duration of each beat.
