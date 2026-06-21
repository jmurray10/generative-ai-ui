# Architecture — GenUI Playground

A public demonstration of **hybrid generative UI**: a person describes an
interface in natural language, a model emits a declarative spec, and the client
renders it as a working, interactive UI — combining several generation strategies
in one output.

> This is a **demo of how generative UI can be done** (reflected in both the docs and
> the frontend), not a production product.

---

## 1. The hybrid concept

Think of the lanes below as a **toolbox the model pulls from** to generate the UI.
**Nothing is hard-coded** — there are no canned/pre-baked specs; the gallery is just
example *prompts*, and every UI shown is produced by the model live. Most "AI builds
a UI" systems pick one strategy; this project gives the model three tools and lets it
choose per node:

### Lane A — Constrained / safe (the registry)
The model emits a **declarative JSON spec** that references a fixed, whitelisted
catalog of React components. It never writes executable code in this lane — it
*composes* audited components and fills their props. Dynamic values come from a
small reactive state layer whose expressions are evaluated by a **safe parser**
(`expr-eval`), never `eval` or `new Function`.

- **Pros:** safe, deterministic, reliable, fast, fully inspectable.
- **Cons:** bounded by the component vocabulary — the model can't invent new
  component types here (by design).
- **Good for:** forms, calculators, dashboards, charts, key/value displays.

### Lane B — Vanilla sandbox (`CustomWidget`)
For self-contained canvas/vanilla-JS visuals, the model emits a `CustomWidget`
whose arbitrary HTML/JS/CSS runs inside an **isolated iframe**
(`sandbox="allow-scripts"`, no `allow-same-origin`). Real and unbounded, but
**jailed**: it cannot read or write the parent page, cookies, or storage.

- **Good for:** Snake, particle/canvas animations, simulations.

### Lane C — Freeform React/Tailwind artifact (`ReactArtifact`)
The most powerful lane and the biggest design lever. The model writes a real
React component — `function App(){ return (<div className="…tailwind…">…</div>) }` —
transpiled by Babel and rendered inside an isolated sandboxed iframe with
**React + Tailwind from CDN**. Two runtimes, auto-selected by whether the code uses
ES `import`s:
- **Classic** (no imports): UMD React + Babel classic; hooks pre-provided; the frame
  auto-resizes to content. Best for small self-contained components.
- **Module** (uses imports): an **import map + esm.sh** lets the model `import` real
  npm packages — `react`, `lucide-react`, `react-icons`, `hls.js`, `framer-motion`,
  `recharts`, `d3`, `three` + `@react-three/fiber`, `@dnd-kit/*`, `gsap`,
  `react-markdown`, `date-fns`, `canvas-confetti`, `clsx`, `zustand` — running as a
  blob ES module (deps deduped to one React via `?external`). Module artifacts may
  also `fetch()` public, CORS-enabled APIs (open-meteo, coingecko, github, …) for
  **live data**, with a loading state. Each iframe posts a text digest to the parent
  (`data-artifact-text`) so the voice agent's `read_ui` can see inside it.

A shared shim installs in-memory `localStorage`/`sessionStorage` (the sandbox lacks
same-origin) and an error reporter; the iframe is granted `allow="autoplay;
fullscreen; encrypted-media"`.

- **Pros:** unbounded design + layout — bespoke cards, landing/hero sections,
  pricing tables, distinctive dashboards, generative art, games with real graphics.
- **Cons:** opaque (not declarative), less deterministic, **needs internet** (CDN),
  isolated (can't read the shared state).
- **Good for:** anything the registry would render too generically. *This is the
  "truly dynamic" lane.*

### Why it's a *true* hybrid
- All three lanes are fully implemented and exercised (a dashboard uses Lane A; the
  Snake game uses Lane B; a designed pricing/weather card uses Lane C).
- **A single generated spec can mix lanes.** Asked for "a snake game," the model
  returned a `Card` + `Badge` + `Collapsible` + `List` (Lane A) wrapped around a
  sandboxed `CustomWidget` (Lane B).
- The model selects the lane per node based on the task (verified: it picks
  `ReactArtifact` for "a beautifully designed glassmorphism card").
- The build log tags each node `registry` vs `🔒 sandboxed` / `🔒 React+Tailwind`,
  so the hybrid is visible as the UI assembles.

---

## 2. End-to-end data flow

```
                          natural-language prompt
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │  SERVER (Express + tsx, :8080)                         │
        │                                                        │
        │  POST /api/stream  ──►  Generator.generate(prompt)     │
        │     (or .refine(prompt, spec) when a spec is supplied) │
        │                              │                         │
        │           ┌──────────────────┴───────────────────┐    │
        │           ▼                                       ▼    │
        │   StubGenerator (offline)              GeminiGenerator │
        │   echo: "connect a model"              @google/genai   │
        │   (no canned specs)                    gemini-3.5-flash│
        │                              │                         │
        │                              ▼                         │
        │                       validateSpec()  (normalize/repair)│
        │                              │                         │
        │     SSE: event meta → event node × N → event done       │
        └──────────────────────────────┬─────────────────────────┘
                                        │  UISpec (JSON), streamed
                                        ▼
        ┌──────────────────────────────────────────────────────┐
        │  CLIENT (React + Vite)                                 │
        │                                                        │
        │  api.streamSpec()  → App appends nodes as they arrive  │
        │                                                        │
        │  GeneratedApp                                          │
        │   • owns the reactive state store (per generation)     │
        │   • renders spec.tree via the component registry       │
        │   • resolves each node's `bind` expressions live       │
        │                                                        │
        │   Lane A: registry (real React) · Lane B: CustomWidget │
        │   · Lane C: ReactArtifact        (sandboxed iframes)    │
        └──────────────────────────────────────────────────────┘
```

`/api/generate` (one-shot JSON) exists for programmatic/API use; the UI uses the
streaming `/api/stream` so generations visibly "build themselves."

---

## 3. The spec format

`src/shared/spec.ts` — shared by server (produces specs) and client (renders them).

```ts
interface UISpec {
  title?: string;
  initialState?: Record<string, JSONValue>;  // seeds the reactive store
  theme?: UITheme;                            // optional palette + Google Font (see §8)
  tree: UINode[];
}

interface UINode {
  id: string;
  type: string;                       // registry component name, or "CustomWidget"
  props?: Record<string, JSONValue | UIAction>;
  bind?: Record<string, string>;      // prop name → expression evaluated vs. state
  children?: UINode[];
}

interface UIAction {                  // dispatched by Button etc.
  type: 'set' | 'increment' | 'toggle' | 'reset';
  key?: string;
  value?: JSONValue;
}
```

---

## 4. The reactive state layer (what makes Lane A *interactive*)

`src/client/engine/state.ts`

A generated UI shares one flat state map:

- **Inputs write** to it via their `stateKey` prop (e.g. a `Slider` sets `state.bill`).
- **Buttons mutate** it via a declarative `action` (`set` / `increment` / `toggle`
  / `reset`), applied by a pure reducer (`applyAction`).
- **Display components read** computed values via `bind`: each entry maps a prop
  name to an expression recomputed on every render.

Expressions are evaluated by **`expr-eval`'s `Parser`** — a sandboxed arithmetic/
logic evaluator supporting `+ - * / %`, comparisons, ternaries, and a fixed set of
math functions. It is **not** JavaScript: no property access, no function calls
beyond the whitelist, no `eval`. Example bind: `bill * (1 + tipPct / 100) / people`.

This is the key to turning a "static dashboard" into a working app **without** ever
running model-authored code in the safe lane.

---

## 5. The sandbox lane (Lane B)

`CustomWidget` in `src/client/engine/components.tsx` renders:

```html
<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc="…">
```

The model-provided `html` / `css` / `script` are composed into a self-contained
document. Because the sandbox grants only `allow-scripts` (and **not**
`allow-same-origin`):

- the iframe is a unique, opaque origin — it cannot access the parent DOM,
  `localStorage`, cookies, or the playground's state;
- it has no ambient network credentials;
- a crash or infinite loop is contained to the iframe.

It cannot read or write the shared reactive store — it is fully isolated by design.

---

## 6. Generation layer

`src/server/generator.ts` — everything talks to one interface:

```ts
interface Generator {
  name: 'stub' | 'gemini';
  generate(prompt): Promise<UISpec>;
  refine(prompt, spec): Promise<UISpec>;   // natural-language edit of an existing spec
  generateApp(prompt): Promise<UISpec>;    // multi-screen: plan → expand → assemble (§8)
}
```

JSON is extracted with a string/escape-aware **balanced-brace scan** (robust to
prose or trailing fenced blocks), and `finishReason` is logged so truncation is
visible.

- **`StubGenerator`** (no key): has **no canned UIs** — it returns a "connect a
  model" notice. Generation is the model's job, so real output requires a model.
- **`GeminiGenerator`**: calls Gemini (`@google/genai`, default `gemini-3.5-flash`)
  with a `systemInstruction` (`src/server/prompt.ts`) that pins the exact component
  vocabulary, the state/bind/action conventions, the safe-expression subset, and
  three few-shot examples. Output is requested as JSON, extracted, and validated.

`getGenerator()` selects Gemini when `GENERATOR=gemini` and a key is present;
otherwise the stub.

**Validation** (`src/server/validate.ts`): `validateSpec()` normalizes/repairs model
output (missing ids, non-object props, non-array children, non-string binds) and
rejects only irrecoverable shapes. Unknown component types are *kept* — the client
renders a graceful placeholder rather than crashing.

---

## 7. Streaming & the "watch it build" reveal

`POST /api/stream` generates (or refines) the **full** spec, then emits it
progressively over SSE:

```
event: meta   data: { title, initialState, count, source }
event: node   data: { index, node }      // one per top-level node, small stagger
event: done   data: { spec }
event: error  data: { error }
```

The client (`api.streamSpec`) parses the frames; `App` shows a **skeleton** during
the wait, a **build log** narrating components (tagging sandboxed ones), a
**progress bar**, then a **provenance** strip that honestly labels the source
(*Generated by Gemini* vs *Generated (offline demo)*). Each node fades in via
`animate-rise`.

> Note: top-level streaming granularity is coarse when the model wraps everything in
> a single root node (progress reads `0/1 → 1/1`); the build log still lists every
> component. Finer child-level streaming is a planned enhancement.

---

## 8. Refinement, multi-screen, voice & theming

- **Chat refine:** the refine bar sends `{ prompt, spec }` to `/api/stream`;
  `GeminiGenerator.refine` returns the full updated spec, which re-streams.

- **Multi-screen (plan→expand):** prompts that read as multi-screen
  (deck/onboarding/wizard/flow/…) route to `GeminiGenerator.generateApp`, which
  plans 2–5 screens, generates each independently (parallel — sidesteps the
  per-response token ceiling and raises per-screen quality), **namespaces** each
  screen's state keys / ids / bind identifiers (`s{i}_…`) to prevent cross-screen
  collisions, then assembles a `Tabs` shell (re-validated). Screens are often
  self-contained `ReactArtifact`s, in which case there's no shared state to clash.

- **Voice — Gemini Live:** a WebSocket at `/voice` (`src/server/voice.ts`, `ws`
  package) bridges the browser to the **Gemini Live API** (`ai.live.connect`,
  native-audio model, voice Kore). The browser streams 16 kHz PCM mic audio
  (`src/client/voice/audio.ts`); the model replies with 24 kHz audio plus
  input/output transcripts. The agent has three function-calling tools:
  - `read_ui` — a **live round-trip**: the server asks the browser for the *current*
    on-screen text on each call, so it observes its own edits (not a snapshot taken
    at connect time); sandboxed iframes contribute via `data-artifact-text`.
  - `refine_ui` / `generate_ui` — edit or replace the UI; `refine_ui` reports
    `ok:false` on a no-op instead of claiming success.

  The session enables `contextWindowCompression` + `sessionResumption` and
  **transparently reconnects** (persisting the resumption handle) on a server
  `goAway`, so long sessions survive.

- **Generative theming:** a spec may include `theme` (palette hex + a Google Font).
  `GeneratedApp` maps it to scoped `--gp-*` CSS variables on the generated section
  (the registry's Tailwind tokens are var-driven, so **no per-component change**). A
  deterministic **WCAG contrast pass** flips illegible text to black/white, derives
  a guaranteed-legible `muted`, and flips on-accent button text by luminance — so
  any model-chosen palette stays readable. Sandboxed lanes theme themselves.

---

## 9. Safety model (summary)

| Surface | What runs | Why it's safe |
|---|---|---|
| Registry components | pre-written React, audited | model only picks types + props; no codegen |
| `bind` expressions | `expr-eval` arithmetic/logic | sandboxed parser, not JS; no `eval`/`new Function` |
| `CustomWidget` | model-authored HTML/JS | isolated iframe, `allow-scripts` only (no same-origin/network) |
| `ReactArtifact` | model-authored React+Tailwind | isolated iframe (no same-origin); can only reach CORS-permitting origins (no allowlist enforced) |
| Spec ingestion | server `validateSpec` | normalizes/repairs; unknown types degrade gracefully |

---

## 10. Component catalog (Lane A, ~28)

- **Layout:** Stack, Row, Grid, Card, Tabs, Collapsible, Divider
- **Display:** Heading, Text, Stat, Badge, List, KeyValue, ProgressBar, Gauge
- **Charts (inline SVG):** BarChart, LineChart, PieChart
- **Input:** Slider, NumberInput, TextInput, Toggle, Select, RadioGroup, ColorPicker, Swatch
- **Action:** Button
- **Vanilla sandbox (Lane B):** CustomWidget
- **React/Tailwind sandbox (Lane C):** ReactArtifact

Keep this in sync across `components.tsx` (registry), `prompt.ts` (what the model is
told), and `validate.ts` (`KNOWN_TYPES`).

---

## 11. File map

```
src/
  shared/spec.ts            # UISpec / UINode / UIAction / UITheme (shared types)
  server/
    index.ts                # Express: /api/*, /api/stream (SSE), /voice (WS), /docs, static
    voice.ts                # Gemini Live voice agent (WebSocket /voice) + read_ui/refine_ui/generate_ui tools
    generator.ts            # Generator: Stub + Gemini (generate/refine/generateApp), balanced-brace JSON extract
    prompt.ts               # system instruction + few-shot examples (one themed)
    validate.ts             # validateSpec(): normalize/repair model output (+ theme passthrough)
    examples.ts             # gallery example *prompts* (no canned specs)
    openapi.ts              # OpenAPI 3 doc (served at /docs, /openapi.json)
  client/
    App.tsx                 # playground shell: prompt, streaming UX, refine, gallery, voice
    api.ts                  # streamSpec() SSE parser (+ done-fallback), generate(), fetchExamples()
    voice/                  # Gemini Live client: audio.ts (mic/playback), useLiveVoice.ts, VoicePanel.tsx
    engine/
      components.tsx        # registry (Lane A) + CustomWidget (Lane B) + ReactArtifact (Lane C) + import map
      state.ts              # reactive store, safe expression eval, action reducer
      GeneratedApp.tsx      # renders a UISpec; owns per-generation state; applies theme (WCAG contrast pass)
scripts/                    # Playwright: e2e.mjs, features.mjs, theme.mjs, voice-agent.mjs, voice-live.mjs
```

---

## 12. Honest limitations

- **Generation requires a model.** Everything is model-authored — there are no
  canned specs. Without a key the playground loads but can't generate (it shows a
  notice); with a Gemini key it generates live across the toolbox.
- **Lane A is a fixed vocabulary.** New component *types* can't be invented in the
  safe lane; unbounded novelty only via the sandbox.
- **Binds are numeric/boolean** (expr-eval), not arbitrary JS — intentional.
- **Top-level streaming is coarse** for single-root specs (see §7).

---

## 13. Configuration

`.env` (copy from `.env.example`):

```
PORT=8080
GENERATOR=stub            # or "gemini"
GEMINI_API_KEY=…          # (or GOOGLE_API_KEY) — only for gemini mode
GEMINI_MODEL=gemini-3.5-flash
STREAM_STAGGER_MS=110     # per-node SSE stagger (visual pacing)
```

Run: `npm run dev` (Vite :5173 + server :8080) · `npm start` (prod) ·
`docker compose up --build`. API docs at `/docs`.
