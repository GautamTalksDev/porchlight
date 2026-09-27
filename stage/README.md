# Stage autopilot

One press of the real beacon starts the show. The screen runs itself while the team talks: it plays the landing page, switches to the node console and the operations room, glides a cursor, clicks the coordinator's buttons and spotlights what the speaker is describing. It never fakes an event. It waits for the real ones: the press, the neighbour's On my way, the fall, the mug, the voice command.

## Once, before the show

1. Install: `cd stage && npm install`. If you use Playwright's own Chromium instead of your installed Chrome, also run `npx playwright install chromium` and start with `STAGE_CHANNEL= npm run stage`.
2. Beacon firmware: set `ACK_GREEN_SEC 20` in config.h and flash, so the beacon is idle again in time for the fall.
3. Nodes and the City: set `BUDDY_WINDOW_SEC=60` and `STREET_WINDOW_SEC=60` in your laptop .env and in the server's .env, restart the nodes and redeploy, so the buddy banner is still up when Adam speaks.
4. Run the autopilot once and sign in to the operations room in its browser (Auth0 and MFA). The profile in `stage/.profile` remembers it.

## Every show

1. Reset: Shift+R in the ops room, stop the nodes, `npm run demo:reset`, start the nodes.
2. Connect the beacon by Bluetooth in **your own Chrome** on localhost:7401, and leave that tab alone. The autopilot's browser only watches the node console; it never connects to the beacon.
3. Park the real mouse in a corner of the screen.
4. `npm run stage` from the repo root (or `cd stage && npm run stage`). It loads everything, declares an emergency, cuts the city link, and prints **Armed**.
5. Gautam presses the beacon on his first word. From then on, follow the cues printed in the terminal.

## Controls

| Key | What it does |
| - | - |
| Space | Pause or resume |
| Right arrow | Skip the current wait |
| F | Fallback for the current step only: simulates the beacon from the node console, and says so in the terminal |
| Q | End the show |

The keys work in the projector window and in the terminal.

## Rehearsal

`npm run rehearse` runs the same show with every hold halved. After each run, the timing of every beat is saved in `stage/logs/`, with the total at the end.
