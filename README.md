# GenUI Playground

[![CI](https://github.com/jmurray10/generative-ai-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/jmurray10/generative-ai-ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/react-18-149eca.svg)](#run-it)
[![TypeScript](https://img.shields.io/badge/typescript-5-3178c6.svg)](#run-it)
[![LLM](https://img.shields.io/badge/LLM-Grok-8e75ff.svg)](https://docs.x.ai/)
[![Router](https://img.shields.io/badge/router-Jev-ff6a3d.svg)](#jev-picks-the-tools)

**Describe an interface. Then talk to it.** Type a sentence and a working,
interactive UI builds itself. Then chat with it or speak to it, and an agent
**operates** the UI for you (moves the slider, presses play, flies to Saturn)
instead of regenerating it.

> **This is a demo of *how* generative UI can be done.** Nothing is hard-coded:
> the gallery is just example *prompts*, and every UI is generated live from a
> toolbox. Generation needs a model key; without one the app loads and says so.

![GenUI Playground — “Fly to Saturn” flies the camera in a generated three.js scene](docs/demo.png)

## What's in the loop

```
 prompt ──▶ /api/decide ──▶ Jev: route · ask one question · hold
               │
               ▼ route (lane, pieces, style family)
          /api/stream ──▶ Grok writes a design brief, then the UISpec, node by node
               │
               ▼
        live UI  ◀──── acts ──── /api/chat   (typed)
          ▲                      /voice      (Grok speech-to-speech)
          └── read: screen text + controls ──┘
```

1. **Route.** [Jev](#jev-picks-the-tools) reads the prompt and decides *how* to build it:
   which lane, which structural pieces it needs (table, drawer, stepper…), whether to
   ask you one question first, or whether to hold it (prompt injection,
   contradictions).
2. **Design & build.** Grok commits to a **design brief** before writing any UI: one
   of 13 named directions, a font pair, a palette, one signature moment. The model's
   output is streamed and read as it arrives, so the build timeline shows real
   progress (choose tools → think → brief, shown as soon as it's written → each part
   as it lands → render) with an elapsed timer and no made-up percentage.
   You can type the request or **say it**: the voice agent hands spoken requests to
   the same routed, streamed build, then stays in the conversation to operate the result.
3. **Operate.** Chat and voice share one control surface. Registry UIs expose every
   input and button automatically (`set:rate`, `press:reset`); sandboxed apps expose
   named actions with `window.genui.expose({...})` (`call:play`, `call:flyTo`), which
   run inside their iframe. The agent rebuilds only when you ask for a design or
   structural change, and after acting it reports what actually happened (read back
   from the app), not what it meant to do.

## Demos

Unedited screen recordings of live runs against the real APIs: Jev's router picks
the tools, `grok-4.7` generates every interface, and voice is Grok's realtime
speech-to-speech (`grok-voice-latest`). The generation wait is sped up 8×;
everything after it plays in real time. Click a still to play the clip.

<table>
<tr>
<td width="50%"><a href="docs/media/drum-machine-chat.mp4"><img src="docs/media/drum-machine-chat.png" alt="A generated drum machine operated by chat"></a><br><sub><b>Chat operates the app</b>: one sentence becomes the drum machine's own actions (preset, tempo, play), then pads toggle on request.</sub></td>
<td width="50%"><a href="docs/media/voice-affordability.mp4"><img src="docs/media/voice-affordability.png" alt="Voice sets the interest rate and reads back the payment"></a><br><sub><b>Voice, with sound</b>: a spoken request sets the rate on a registry UI (no rebuild), then Grok reads the new monthly payment aloud.</sub></td>
</tr>
<tr>
<td><a href="docs/media/solar-system-chat.mp4"><img src="docs/media/solar-system-chat.png" alt="A three.js solar system driven by chat"></a><br><sub><b>3D, by conversation</b>: a three.js solar system; “fly to Saturn” and “speed time up” call the scene's exposed actions.</sub></td>
<td><a href="docs/media/jev-asks-first.mp4"><img src="docs/media/jev-asks-first.png" alt="Jev asks one question before building a dashboard"></a><br><sub><b>Jev asks first</b>: “a dashboard” is too vague, so Jev (about 130 ms) asks what data it should show, then routes and builds from the answer, and chat answers from the screen.</sub></td>
</tr>
</table>

In the voice clips the request is a pre-recorded line in xAI's `leo` voice, fed to
the browser as its microphone; Grok answers in the app's `eve` voice. The
conversation panel shows both transcripts.

### Every example, by voice

One short clip per gallery example: the live build timeline (the wait compressed to
about 3 seconds), then a spoken command operates the generated app and Grok answers
aloud. Sound on.

<table>
<tr>
<td width="33%"><a href="docs/media/voice-trading.mp4"><img src="docs/media/voice-trading.png" alt="Trading terminal switched to Ethereum by voice"></a><br><sub><b>Trading terminal</b>: “Switch the chart to Ethereum.”</sub></td>
<td width="33%"><a href="docs/media/voice-solar.mp4"><img src="docs/media/voice-solar.png" alt="3D solar system flies to Saturn by voice"></a><br><sub><b>3D solar system</b>: “Fly to Saturn.”</sub></td>
<td width="33%"><a href="docs/media/voice-drums.mp4"><img src="docs/media/voice-drums.png" alt="Drum machine plays a preset by voice"></a><br><sub><b>Drum machine</b>: “Play the funkiest preset at 128.”</sub></td>
</tr>
<tr>
<td><a href="docs/media/voice-mortgage.mp4"><img src="docs/media/voice-mortgage.png" alt="Home affordability rate set by voice"></a><br><sub><b>Home affordability</b>: “Set the rate to 6¼%. What is the payment?”</sub></td>
<td><a href="docs/media/voice-incidents.mp4"><img src="docs/media/voice-incidents.png" alt="Incident console filtered by voice"></a><br><sub><b>Incident console</b>: “Show only the critical alerts.”</sub></td>
<td><a href="docs/media/voice-snake.mp4"><img src="docs/media/voice-snake.png" alt="Snake started by voice"></a><br><sub><b>Snake</b>: “Start the game.”</sub></td>
</tr>
</table>

## The three lanes

The model picks per node from a toolbox (Jev can pin the lane):

- **Registry + state** (`src/client/engine/components.tsx`): ~28 audited React
  components. The model only fills props. Values live in one reactive state map;
  `bind` expressions run in a safe parser (`expr-eval-fork`, no `eval`). A spec can
  carry a `theme` (palette + Google Font) that passes a deterministic WCAG contrast
  check. Every input and button is operable by chat and voice for free.
- **JS sandbox** (`CustomWidget`): vanilla HTML/JS in a `sandbox="allow-scripts"`
  iframe with a network-blocking CSP: canvas visuals, games.
- **React sandbox** (`ReactArtifact`): freeform React + Tailwind, transpiled in a
  sandboxed iframe, with real npm imports (recharts, three, framer-motion, dnd-kit,
  gsap…) and `fetch()` to a short allow-list of public APIs.

## Jev picks the tools

[Jev](https://typesafe.ai) (TypeSafe) is a typed decision model: it answers a fixed
set of typed questions about the prompt (which lane fits, does it need a table or a
drawer, is anything missing, is it an injection attempt) with calibrated
probabilities. **The policy that turns those answers into a decision is code**
(`src/server/jev/policy.ts`), with thresholds tuned on a labelled set
(`scripts/jev-prompts.json`, `scripts/jev-eval.ts`):

| Decision | What the playground does |
| -------- | ------------------------ |
| `route`  | builds with the chosen lane and pieces; the style family is a hint for the design brief, never a template |
| `ask`    | the panel asks one question (or **Just build it**); the answer re-routes once and never asks again |
| `hold`   | injection or contradiction: nothing is built. Low confidence or a router error: the model chooses the tools |

With `TYPESAFE_API_KEY` set, Jev itself decides. Without it, a Grok "judge" answers
the same questions (`JEV_JUDGE_MODEL`, about 2 s on a non-reasoning model) and the
panel labels it as the stand-in.

## Run it

```bash
cp .env.example .env     # add XAI_API_KEY (and TYPESAFE_API_KEY for Jev)
docker compose up --build        # http://localhost:8080
```

Compose runs the frontend and backend as two services, built from one multi-stage
`Dockerfile`:

| Service | Image target | What it does |
| ------- | ------------ | ------------ |
| `web` | `web` | nginx with the built client; proxies `/api`, `/voice` (WebSocket), `/docs` to `api` on the same origin, with buffering off for the build stream. The only published port. |
| `api` | `api` | Express on tsx: generation, chat, Jev routing, realtime voice. No client bundle. |

Each image deploys on its own (point `API_UPSTREAM` at wherever the API runs).
`docker build --target all .` still builds the single container that serves both.

**Logs.** `docker compose logs -f api` prints one line per event: requests, Jev
decisions, the design brief, model calls (latency, time to first token, input,
cached, output and reasoning tokens), chat acts, and voice tool calls. Lines for one
request share an `rid`, and voice sessions share an `sid`. Set `LOG_LEVEL=debug` for
each streamed part and voice transcripts, or `LOG_FORMAT=json` for a log shipper.
`docker compose logs -f web` is the nginx request log, with upstream timings.

```
INFO  http    decision rid=be4b62 decider=grok kind=route lane=registry style=soft_consumer ms=2766
INFO  http    build start rid=58992f lane=registry style=soft_consumer prompt="A tip calculator app…"
INFO  http    design brief rid=58992f direction=Organic ms=3503
INFO  grok    model call rid=58992f call=ui_spec model=grok-4.7 ms=7731 firstTokenMs=2308 inTok=6352 cachedTok=1152 outTok=685
INFO  voice   tool sid=351008 name=act_ui ms=2 ok=true acts=set:bill
```

Without Docker:

```bash
npm install
npm run dev          # client on :5173, API on :8080
# or: npm run build && npm start
```

## API

Swagger UI at **`/docs`** (raw spec at `/openapi.json`).

| Method | Path            | Description |
| ------ | --------------- | ----------- |
| GET    | `/api/health`   | Liveness, generator, voice and router in use |
| GET    | `/api/examples` | Example *prompts* for the gallery (no canned specs) |
| POST   | `/api/decide`   | `{ prompt, answered? }` → Jev decision: route / ask / hold |
| POST   | `/api/stream`   | `{ prompt, spec?, lane?, components?, style? }` → SSE build: `progress` (phase, brief, parts) while the model writes, then `meta`, `node`, `done` |
| POST   | `/api/generate` | `{ prompt }` → `{ spec }` (one-shot JSON) |
| POST   | `/api/chat`     | `{ message, spec, readable, controls, history }` → `{ reply, acts, spec? }` |
| POST   | `/api/chat/confirm` | `{ message, results, readable }` → `{ reply }` grounded in what the acts actually did |
| WS     | `/voice`        | Grok speech-to-speech with `read_ui`, `act_ui`, `refine_ui`, `generate_ui` |

## Configuration

| Variable | Default | |
| -------- | ------- | - |
| `XAI_API_KEY` | | Required for generation, chat, voice and the Jev stand-in |
| `GROK_MODEL` | `grok-4.7` | Generation and chat (Responses API, JSON schema) |
| `GROK_VOICE_MODEL` / `GROK_VOICE` | `grok-voice-latest` / `eve` | Realtime voice |
| `TYPESAFE_API_KEY` | | Turns on Jev itself for routing |
| `TOOLBOX_DECIDER` | `auto` | `jev`, `grok` or `auto` (Jev when keyed, else the Grok judge) |
| `JEV_JUDGE_MODEL` | `grok-4.20-0309-non-reasoning` (compose) | Model for the Grok judge |
| `GENERATOR` | `grok` | `gemini` and `stub` stay available; `VOICE_PROVIDER=gemini` keeps Gemini Live |

| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `pretty` | `debug` adds streamed parts and voice transcripts; `json` for log shippers |

Optional: `XAI_BASE_URL`, `GROK_REASONING_EFFORT` (default `low`),
`RATE_LIMIT_PER_MIN`, `MAX_PROMPT_CHARS`, `STREAM_STAGGER_MS`, `CORS_ORIGIN`,
`TRUST_PROXY` (default: private-network proxies), `WEB_PORT` (compose, default 8080),
`API_UPSTREAM` (web image, default `api:8080`), `MAX_SPEC_CHARS` (200000),
`VOICE_MAX_SESSIONS` (2 per client), `VOICE_OPENS_PER_MIN` (10). Security notes are in
[`SECURITY.md`](./SECURITY.md).

## Checks

```bash
npm run typecheck && npm test        # 83 unit tests: Jev policy, chat runner, controls, spec, stream progress, voice guard, voice events
node scripts/e2e.mjs                 # live: Jev route, live build timeline, design brief, chat operating a registry UI and a sandboxed app
node scripts/voice-agent.mjs         # live: read_ui → act_ui → read_ui over /voice, no rebuild
node scripts/voice-build.mjs         # live: build a UI by voice from the landing page, then operate it by voice
node scripts/live-grok.mjs           # live: generate, render, one voice turn
node scripts/security-check.mjs      # live, no model calls: /voice origin rule, CORS off, spec cap, sandbox navigation, CSS colors
node scripts/record.mjs              # re-record the demo clips (needs ffmpeg); voice-<example> for the per-example clips
```

The live scripts need a running server with `XAI_API_KEY` and are not part of CI.

## Credits

The design brief adapts ideas from Anthropic's
[frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
and [impeccable](https://github.com/pbakaus/impeccable) (both Apache-2.0); the
wording in `src/server/prompt.ts` is ours. Jev and its tuned questions come from
the `design-showcases` work.

## Project layout

```
generative-ai-ui/
├── Dockerfile                    multi-stage: api, web, all
├── docker-compose.yml            web (nginx + client, :8080) and api (Express) services
├── deploy/nginx.conf.template    same-origin proxy for /api, /voice, /docs
├── docs/                         README assets (hero still, demo clips)
├── scripts/                      e2e, voice and live checks, Jev eval, clip recorder
└── src/
    ├── shared/                   spec.ts (UISpec), control.ts (controls + acts), toolbox.ts (Jev decision)
    ├── server/
    │   ├── index.ts              routes: /api/decide, /api/stream, /api/chat, /api/generate, /docs
    │   ├── toolbox.ts, jev/      Jev client, Grok judge, code-owned policy + thresholds
    │   ├── prompt.ts             system prompt: component vocabulary, design brief, interaction rules
    │   ├── grok.ts               Grok generator (design brief first in the schema, streamed)
    │   ├── spec-progress.ts      reads the streamed spec: phase, brief, parts
    │   ├── log.ts                one-line structured logs
    │   ├── chat.ts               chat turn: answer, operate (acts) or rebuild
    │   ├── voice*.ts             /voice bridge and its tools
    │   └── validate.ts           server-side validateSpec
    └── client/
        ├── App.tsx               route → build → operate flow
        ├── shell/                Landing (hero, gallery), Conversation (decision card, thread, composer)
        ├── engine/               registry, sandboxes + genui bridge, reactive state, control hub
        └── voice/                realtime audio + socket hook
```

More detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md); how each model is used is in
[`LLM.md`](./LLM.md), including a **PEAS spec** (performance measure, environment,
actuators, sensors) for each of the four agents (router, generator, chat, voice), how
each environment is classified, and why each one gets the architecture it has.

## Contributing

Issues and PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Report security issues
privately via [`SECURITY.md`](./SECURITY.md). Participation is under the
[Code of Conduct](./CODE_OF_CONDUCT.md). Notable changes are tracked in
[`CHANGELOG.md`](./CHANGELOG.md).

## License

MIT — see [`LICENSE`](./LICENSE).

## Contact

Built by **Jeff Murray** ([@jmurray10](https://github.com/jmurray10)).

- Email: **jeff.murray@alumni.upenn.edu**
- LinkedIn: [linkedin.com/in/jeff-murray-ai](https://www.linkedin.com/in/jeff-murray-ai)
- GitHub: [@jmurray10](https://github.com/jmurray10)
