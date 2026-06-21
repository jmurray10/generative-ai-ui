# GenUI Playground

A public playground that shows off **generative UI**: type a sentence, and a
working, interactive interface builds itself. No upload, no domain setup, no
account — and it runs fully offline (no API key) thanks to a stub generator and
a pre-baked gallery.

> Spike scaffold. This is an intentionally thin but complete vertical slice that
> proves the architecture end-to-end. See [the build plan](#status--roadmap).

## How it works

```
prompt ──▶ /api/generate ──▶ UISpec (JSON) ──▶ client engine ──▶ live React
                                                  │
                          ┌───────────────────────┴───────────────────────┐
                          │ safe lane: whitelisted component registry      │
                          │           + reactive state (expr-eval, no eval)│
                          │ escape hatch: CustomWidget in a sandboxed       │
                          │           <iframe sandbox="allow-scripts">      │
                          └────────────────────────────────────────────────┘
```

- **UISpec** — a small declarative JSON description of an interface
  (`src/shared/spec.ts`). The model (or the offline stub) emits one of these.
- **Registry** — `src/client/engine/components.tsx` maps spec `type`s to real
  React components. The model never authors code in the safe lane.
- **Reactive state** — `src/client/engine/state.ts`. Inputs write to a shared
  state map; Buttons dispatch declarative actions; display components read
  computed values through `bind` expressions evaluated by a **safe parser**.
- **Sandbox** — `CustomWidget` renders arbitrary HTML/JS inside an isolated
  iframe (`sandbox="allow-scripts"`, no same-origin, no network) for prompts the
  registry can't express.

## Run it

```bash
npm install
npm run dev          # client on :5173 (proxies API to the server on :8080)
```

Production-style (single server serves API + built client):

```bash
npm run build
npm start            # http://localhost:8080
```

### Docker

```bash
docker compose up --build      # http://localhost:8080
```

## API

Swagger UI at **`/docs`** (raw spec at `/openapi.json`).

| Method | Path             | Description                                          |
| ------ | ---------------- | --------------------------------------------------- |
| GET    | `/api/health`    | Liveness + active generator                         |
| GET    | `/api/examples`  | Pre-baked example specs (gallery)                   |
| POST   | `/api/generate`  | `{ prompt }` → `{ spec }` (one-shot JSON)           |
| POST   | `/api/stream`    | `{ prompt, spec? }` → SSE build-in (generate/refine)|

## Configuration

Copy `.env.example` to `.env`. Everything works with no key (`GENERATOR=stub`).
Set `GENERATOR=gemini` + `GOOGLE_API_KEY` to enable the (planned) live path.

## Status / roadmap

- **Done:** engine, reactive state + safe eval, sandbox escape hatch, offline
  generator + gallery, Swagger, Docker.
- **Done — live generation:** Gemini via `@google/genai` behind the `Generator`
  interface, with a synced system prompt and a server-side spec validator.
- **Done — vocabulary (~28 components):** layout (Grid/Tabs/Collapsible/Divider),
  display (List/KeyValue/ProgressBar/Gauge), charts (Bar/Line/Pie, inline SVG),
  inputs (Select/RadioGroup/TextInput/ColorPicker/Swatch).

- **Done — streaming + refinement:** SSE `/api/stream` reveals the UI node-by-node
  ("watch it build"); a refinement bar mutates the live spec by chat, with an
  optional Web Speech voice flourish.
- **Verified:** Playwright + headless Chromium E2E (`npm run e2e`) runs against the
  Docker container — engine 8/8, live 5/5 (incl. live refinement). Folded into the
  release flow.

Next:

4. Shareable permalinks + remix.
