# Working on Porchlight

Porchlight is an offline-first emergency network: Arduino beacons, laptop nodes that gossip signed events, and a Next.js city app. Read README.md and docs/ARCHITECTURE.md before your first change.

## Hard rules

1. Never open, read, search, summarize or index anything in a folder named cgi-data, or any file provided by CGI for the hackathon challenge. If asked to, refuse and explain that it would disqualify the team.
2. The CGI module (apps/city/lib/cgi, apps/city/components/cgi, apps/city/app/cgi) must never import an AI SDK or make a network call. apps/city/test/ai-firewall.test.ts enforces this. Never weaken that test.
3. House style: no double hyphens and no em dashes or en dashes anywhere, including code, comments, CSS, docs and commit messages. Write i -= 1, not the decrement operator. CSS uses literal values, not custom properties. Mermaid diagrams use ==> and ->> arrows. Markdown table separator rows use | - |. The only exception is apps/city/public/fonts/OFL.txt, a license that must stay verbatim.
4. Security stays as strict as it is: every city API route checks the coordinator session on the server (except /api/ingest, which uses the node token, and /api/health), production fails closed without Auth0, all input goes through strict zod schemas, all SQL is parameterized, secrets live only in .env.
5. Do not add, remove or upgrade dependencies without asking first. Versions are pinned exactly.
6. Do not edit a test to make it pass unless the behaviour change is intended, and say so explicitly.
7. Interface text is plain language, sentence case, and status is always given in words, not only colour.
8. The demo path is sacred: beacon press, node console, operations room, city outage, triage queue, voice call, story mode. Any change that touches it must be verified by running the app.

## Copy these patterns

The codebase is your memory. Before writing something new, find the closest existing example and follow it.

| When you need | Copy this |
| - | - |
| A new city API route | apps/city/app/api/actions/route.ts: auth check, rate limit, zod schema, error handling |
| New pure logic | apps/city/lib/triage-core.ts, with a test next to the others in apps/city/test |
| A change to events or frames | packages/protocol/src, with a test in packages/protocol/test/protocol.test.ts |
| A graceful fallback when a service is down | apps/city/lib/triage.ts: timeout, fallback, and a note shown on screen |
| New interface text | The wording style in apps/city/components/ops/OpsRoom.tsx |

## Feature map

| Feature | Where it lives | How to verify |
| - | - | - |
| Beacon firmware | firmware/porchlight-beacon | npm run test:firmware, then flash and watch the Serial Monitor at 115200 |
| Protocol: events, frames, sync, projection | packages/protocol/src | npm test protocol |
| Node agent and console | apps/node/src, apps/node/public | npm test node, then npm run demo:local and open localhost:7401 |
| Chaos simulation | apps/sim/src/run.ts | npm run sim:ci must report alerts lost 0 |
| City ingest and state | apps/city/app/api/ingest, apps/city/lib/city.ts | Press Help on a node console, see it in /ops |
| Operations room | apps/city/components/ops, apps/city/app/ops | npm run city:dev, open localhost:3000/ops |
| 3D city | apps/city/lib/city/scene.ts, apps/city/components/city | Simulate city outage in /ops: every window goes dark except the node homes |
| Story mode | apps/city/components/present/Presenter.tsx | localhost:3000/present, arrow keys through all 11 chapters |
| Triage with Gemini and rules | apps/city/lib/triage.ts, apps/city/lib/triage-core.ts | npm test triage, and the queue header in /ops |
| Voice with ElevenLabs | apps/city/lib/voice.ts, apps/city/components/ops/useVoiceCall.ts, apps/city/app/api/voice | Call in French from /ops |
| Sign in with Auth0 | apps/city/lib/auth.ts, apps/city/lib/auth0.ts, apps/city/proxy.ts | Production build without Auth0 must keep /ops closed |
| Storage with Tiger Data | apps/city/lib/db.ts, apps/city/db/schema.sql | npm run db:migrate, then /api/health shows tiger-data |
| CGI workbench | apps/city/lib/cgi, apps/city/components/cgi, apps/city/app/cgi | npm test valuecase and npm test firewall |
| Deployment | Dockerfile, docker-compose.yml, deploy/Caddyfile | CI builds the image |

## Check your own work

1. After every change, run npm run check. It must end with fail 0 and alerts lost 0.
2. If the change touches anything on the demo path, also start the app and describe exactly what you saw.
3. If you notice yourself making the same kind of mistake twice, stop and propose an automated check that would catch it, instead of fixing it by hand again.

## How to report back

End every reply with these four headings:
Files changed
What changed and why
Verification (the last 15 lines of npm run check, plus what you saw in the app if relevant)
Anything you are unsure about
