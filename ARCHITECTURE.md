# Architecture — GenUI Playground

A public demonstration of **hybrid generative UI**: a person describes an
interface in natural language, a router decides how it should be built, a model
emits a declarative spec, and the client renders it as a working, interactive UI —
combining several generation strategies in one output. Once it is built, the person
**operates it by chat or voice**: the agent sets values, presses buttons and calls
the app's own actions in place, and only rebuilds when the design has to change.

> This is a **demo of how generative UI can be done** (reflected in both the docs and
> the frontend), not a production product.

---

## 1. The hybrid concept

Think of the lanes below as a **toolbox the model pulls from** to generate the UI.
**Nothing is hard-coded** — there are no canned/pre-baked specs; the gallery is just
example *prompts*, and every UI shown is produced by the model live. Most "AI builds
a UI" systems pick one strategy; this project gives the model three tools and lets it
choose per node — unless the toolbox router (Jev, §14) has already picked the lane.

### Lane A — Constrained / safe (the registry)
The model emits a **declarative JSON spec** that references a fixed, whitelisted
catalog of React components. It never writes executable code in this lane — it
*composes* audited components and fills their props. Dynamic values come from a
small reactive state layer whose expressions are evaluated by a **safe parser**
(`expr-eval-fork`), never `eval` or `new Function`.

- **Pros:** safe, deterministic, reliable, fast, fully inspectable; **operable for
  free** — every input and button becomes a control chat and voice can use (§8).
- **Cons:** bounded by the component vocabulary — the model can't invent new
  component types here (by design).
- **Good for:** forms, calculators, dashboards, charts, key/value displays.

### Lane B — Vanilla sandbox (`CustomWidget`)
For self-contained canvas/vanilla-JS visuals, the model emits a `CustomWidget`
whose arbitrary HTML/JS/CSS runs inside an **isolated iframe**
(`sandbox="allow-scripts"`, no `allow-same-origin`, CSP `connect-src 'none'`). Real
and unbounded, but **jailed**: it cannot read or write the parent page, cookies,
storage, or the network.

- **Good for:** Snake, particle/canvas animations, simulations.

### Lane C — Freeform React/Tailwind artifact (`ReactArtifact`)
The most powerful lane and the biggest design lever. The model writes a real
React component — `function App(){ return (<div className="…tailwind…">…</div>) }` —
transpiled by Babel and rendered inside an isolated sandboxed iframe with
**React + Tailwind from CDN**. Two runtimes, auto-selected by whether the code uses
ES `import`s:
- **Classic** (no imports): UMD React + Babel classic; hooks pre-provided.
- **Module** (uses imports): an **import map + esm.sh** lets the model `import` real
  npm packages — `react`, `lucide-react`, `react-icons`, `hls.js`, `framer-motion`,
  `recharts`, `d3`, `three` + `@react-three/fiber`, `@dnd-kit/*`, `gsap`,
  `react-markdown`, `date-fns`, `canvas-confetti`, `clsx`, `zustand` — running as a
  blob ES module (deps deduped to one React via `?external`). Module artifacts may
  also `fetch()` the public APIs the frame's CSP allows (open-meteo, coingecko,
  github) for **live data**, with a loading state.

Both runtimes post their content height to the host, so the frame auto-sizes
(clamped to 80–2400 px). Each iframe also posts a text digest to the parent
(`data-artifact-text`) so chat and the voice agent's `read_ui` can see inside it, and
artifacts can **expose named actions** (`window.genui.expose`, §8) so the agent can
operate them.

A shared shim installs in-memory `localStorage`/`sessionStorage` (the sandbox lacks
same-origin), an error reporter and the genui bridge; the iframe is granted
`allow="autoplay; fullscreen; encrypted-media"`.

- **Pros:** unbounded design + layout — bespoke cards, landing/hero sections,
  pricing tables, distinctive dashboards, generative art, games with real graphics.
- **Cons:** opaque (not declarative), less deterministic, **needs internet** (CDN),
  isolated (can't read the shared state); only operable through actions it chooses
  to expose.
- **Good for:** anything the registry would render too generically. *This is the
  "truly dynamic" lane.*

### Why it's a *true* hybrid
- All three lanes are fully implemented and exercised (the home-affordability example
  uses Lane A; Snake uses Lane B; the trading terminal, solar system and drum machine
  use Lane C).
- **A single generated spec can mix lanes.** Asked for "a snake game," the model
  returned a `Card` + `Badge` + `Collapsible` + `List` (Lane A) wrapped around a
  sandboxed `CustomWidget` (Lane B).
- The lane is chosen per prompt: Jev routes to `registry` or `sandboxed_react` when it
  is confident (§14); otherwise the model selects per node based on the task.
- The build log tags each node `registry` vs `🔒 sandboxed` / `🔒 React+Tailwind`,
  so the hybrid is visible as the UI assembles.

---

## 2. End-to-end data flow

Every new build is **decide → stream → operate**:

```
                          natural-language prompt
                                   │
   ① DECIDE                        ▼
        ┌──────────────────────────────────────────────────────┐
        │  POST /api/decide  ──►  decideToolbox(prompt)          │
        │    Jev (TypeSafe /v1/systemone)  or  Grok judge        │
        │      → typed answers to 14 questions                   │
        │    policy.ts (code) → route | ask | hold   (§14)       │
        └──────────────────────────────┬─────────────────────────┘
              route: { lane, components, style }   ask: one question
                                        │          hold: stop / fall through
   ② BUILD                              ▼
        ┌──────────────────────────────────────────────────────┐
        │  POST /api/stream  ──►  Generator.generate(prompt,opts)│
        │     (or .refine(prompt, spec) when a spec is supplied) │
        │     user turn = "Build: …" + ROUTING block             │
        │                              │                         │
        │           ┌──────────────────┴───────────────────┐    │
        │           ▼                                       ▼    │
        │   StubGenerator (offline)              GrokGenerator   │
        │   echo: "connect a model"              grok-4.7        │
        │   (no canned specs)                    design brief    │
        │                                        first (§6)      │
        │                              ▼                         │
        │                       validateSpec()  (normalize/repair)│
        │                              │                         │
        │     SSE: event meta → event node × N → event done       │
        └──────────────────────────────┬─────────────────────────┘
                                        │  UISpec (JSON), streamed
   ③ RENDER                             ▼
        ┌──────────────────────────────────────────────────────┐
        │  CLIENT (React + Vite)                                 │
        │  GeneratedApp: state store · registry · sandboxed      │
        │  iframes · theme · attaches its state to controlHub    │
        └──────────────────────────────┬─────────────────────────┘
                                        │  controls: set:<key> · press:<id> · call:<name>
   ④ OPERATE                            ▼
        ┌──────────────────────────────────────────────────────┐
        │  chat:  POST /api/chat → answer | acts | refine/generate│
        │  voice: WS /voice → read_ui | act_ui | refine_ui |      │
        │                     generate_ui                         │
        │  acts run IN THE BROWSER via controlHub (no rebuild);   │
        │  refine/generate go back through the generator (②)      │
        └──────────────────────────────────────────────────────┘
```

The client drives this in `routeThenBuild` (`src/client/App.tsx`): it calls
`/api/decide` before every new build, then streams with the decision's `lane`,
`components` and `style` (§14 lists what each outcome does). `/api/generate`
(one-shot JSON) exists for programmatic/API use and accepts the same routing fields;
the UI uses the streaming `/api/stream` so generations visibly "build themselves."

---

## 3. The spec format

`src/shared/spec.ts` — shared by server (produces specs) and client (renders them).

```ts
interface UISpec {
  design?: UIDesign;                          // the model's design brief, written first (§6)
  title?: string;
  initialState?: Record<string, JSONValue>;  // seeds the reactive store
  theme?: UITheme;                            // optional palette + Google Font (see §8)
  tree: UINode[];
}

interface UIDesign {                  // shown in the canvas header
  direction?: string;                 // e.g. "Swiss grid", "Instrument / cockpit"
  fonts?: string;                     // e.g. "Schibsted Grotesk 400/800"
  palette?: string[];                 // hex values
  signature?: string;                 // the one memorable moment
}

interface UINode {
  id: string;
  type: string;                       // registry component name, or "CustomWidget" / "ReactArtifact"
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

Gallery entries (`Example`) are prompts only, with an optional `lane` label and
`tryIt` phrases to say or type to the built UI.

---

## 4. The reactive state layer (what makes Lane A *interactive*)

`src/client/engine/state.ts`

A generated UI shares one flat state map:

- **Inputs write** to it via their `stateKey` prop (e.g. a `Slider` sets `state.bill`).
- **Buttons mutate** it via a declarative `action` (`set` / `increment` / `toggle`
  / `reset`), applied by a pure reducer (`applyAction`).
- **Display components read** computed values via `bind`: each entry maps a prop
  name to an expression recomputed on every render.

Expressions are evaluated by **`expr-eval-fork`'s `Parser`** — a sandboxed arithmetic/
logic evaluator supporting `+ - * / %`, comparisons, ternaries, and a fixed set of
math functions. It is **not** JavaScript: no property access, no function calls
beyond the whitelist, no `eval`. Example bind: `bill * (1 + tipPct / 100) / people`.

This is the key to turning a "static dashboard" into a working app **without** ever
running model-authored code in the safe lane. It is also what makes registry UIs
operable by an agent: `GeneratedApp` hands its `getState` / `setVar` / `dispatch` to
the control hub (§8), so chat and voice change values through the same API the
components use.

---

## 5. The sandbox lane (Lane B)

`CustomWidget` in `src/client/engine/components.tsx` renders:

```html
<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc="…">
```

The model-provided `html` / `css` / `script` are composed into a self-contained
document with a CSP of `default-src 'none'` and `connect-src 'none'`. Because the
sandbox grants only `allow-scripts` (and **not** `allow-same-origin`):

- the iframe is a unique, opaque origin — it cannot access the parent DOM,
  `localStorage`, cookies, or the playground's state;
- it has no network access and no ambient credentials;
- a crash or infinite loop is contained to the iframe.

It cannot read or write the shared reactive store — it is fully isolated by design.
The document also includes the genui bridge, so a widget's script can call
`window.genui.expose({...})` to let chat and voice operate it (§8).

---

## 6. Generation layer

`src/server/types.ts` / `src/server/generator.ts` — everything talks to one interface:

```ts
interface Generator {
  name: 'stub' | 'grok' | 'gemini';
  model: string | null;
  generate(prompt, opts?: GenerateOptions): Promise<UISpec>;  // opts = Jev routing
  refine(prompt, spec): Promise<UISpec>;   // natural-language edit of an existing spec
  generateApp(prompt): Promise<UISpec>;    // multi-screen: plan → expand → assemble (§8)
}
```

JSON is extracted with a string/escape-aware **balanced-brace scan** (robust to
prose or trailing fenced blocks), and extraction warnings are logged.

- **`StubGenerator`** (no key): has **no canned UIs** — it returns a "connect a
  model" notice. Generation is the model's job, so real output requires a model.
- **`GrokGenerator`** (default): calls Grok (`grok-4.7`) through the OpenAI SDK
  against `https://api.x.ai/v1/responses`, with `instructions` from
  `src/server/prompt.ts` and a JSON schema (`strict: false`, because a UI tree is
  recursive and the API rejects circular `$ref`s). The schema lists a **required
  `design` object first** (`direction`, `fonts`, `palette`, `signature`), so the model
  commits to a design brief before it writes the tree. Output is parsed, extracted if
  the model wrapped it, and validated. Reasoning effort defaults to `low`.
- **`GeminiGenerator`**: opt-in via `GENERATOR=gemini`. Same prompt and routing hints,
  `@google/genai`, `responseMimeType: application/json`.

`getGenerator()` selects Grok when `GENERATOR` is unset or `grok` and `XAI_API_KEY`
is present, Gemini when `GENERATOR=gemini` and a Gemini key is present, and the
stub otherwise.

**Design brief** (`SYSTEM_PROMPT` in `src/server/prompt.ts`): before building, the
model reads the subject and audience and picks one of 13 named directions (Editorial,
Swiss grid, Neo-brutalist, Retro terminal, Quiet luxury, Organic, Toy/playful,
Instrument/cockpit, Synthwave/Y2K, Bauhaus, Dark product, Risograph zine,
Atlas/scientific), each with a suggested Google Font pair; then 1–2 font families with
real contrast, a 3–6 colour palette (one dominant, one accent, tinted neutrals, no pure
black/white surfaces), and **one** signature moment. A NEVER list bans the defaults that
read as "generated" (purple-to-blue gradients, default glassmorphism, Inter/Roboto/Arial/
Space Grotesk as display face, gradient text, three identical cards, icon tiles over
every heading, emoji icons, lorem ipsum, …), and a craft floor asks for realistic
content, tabular numerals, a 4/8 px rhythm, visible focus, WCAG AA contrast and real
empty/loading/error states. The ideas are adapted from Anthropic's frontend-design skill
and pbakaus/impeccable (both Apache-2.0); the wording is ours. The prompt also tells the
model to **expose 2–6 actions** from every `ReactArtifact` / `CustomWidget` (§8).

**Routing hints** (`src/server/route-hints.ts`): when a Jev route is passed in
(`lane`, `components`, `style`), `routeHints()` appends a `ROUTING` block to the user
turn: the lane rule (`registry` → registry components only, with a theme;
`sandboxed_react` → exactly one `ReactArtifact` holding the whole UI), the structural
pieces the UI needs (stepper, data table, side drawer, citations, confirm step), and
the style family **as a hint for the design brief, not a template**. Jev decides *how*
to build; the model still decides how it *looks*. Unknown routing values in a request
body are dropped (`readOptions` in `index.ts`). The multi-screen path and refines do not
take routing.

**Validation** (`src/server/validate.ts`): `validateSpec()` normalizes/repairs model
output (missing ids, non-object props, non-array children, non-string binds, unseeded
state keys) and rejects only irrecoverable shapes. `normDesign` keeps only short string
fields of the design brief (160 chars) and up to 8 valid hex palette values. Unknown
component types are *kept* — the client renders a graceful placeholder rather than
crashing.

---

## 7. Streaming & the "watch it build" reveal

`POST /api/stream` generates (or refines) the **full** spec, then emits it
progressively over SSE:

```
event: meta   data: { title, design, initialState, count, source, degraded, notices }
event: node   data: { index, node }      // one per top-level node, small stagger
event: done   data: { spec }
event: error  data: { error }
```

The client (`api.streamSpec`) parses the frames; `App` shows a **skeleton** during
the wait, the **design brief** in the canvas header as soon as `meta` arrives
(direction, fonts, palette swatches, signature), a **build log** narrating components
(tagging sandboxed ones), then a **provenance** label that honestly names the source
(*Generated by Grok* / *Generated by Gemini* / *Model did not return a UI* /
*Offline — connect a model*). Each node fades in via `animate-rise`.

> Note: top-level streaming granularity is coarse when the model wraps everything in
> a single root node (progress reads `0/1 → 1/1`); the build log still lists every
> component. The SSE reveal starts only after the full spec has been generated.

---

## 8. Operating the UI (chat & voice), refinement, multi-screen & theming

### The control surface

`src/shared/control.ts` defines what a built screen lets an agent **do** without
regenerating it: `UIControl` (id, kind, label, current value, min/max, options, or an
action's description/params), `UIAct` (`{ action, value?, args? }`) and `UIActResult`
(`{ action, ok, detail? }`). `describeControls()` renders the list as one line per
control for a model prompt or a voice tool result; `sanitizeActs()` normalizes
untrusted acts (ids must match `^(set|press|call):[\w.$-]{1,80}$`, at most 12).

`controlHub` (`src/client/engine/control.ts`) is the single place that knows what the
live UI can do and runs it. Chat and voice both go through `controls()` and `run()`,
so typing "set the rate to 6%" and saying it do exactly the same thing.

- **Registry controls** are derived from the spec + current state
  (`registryControls`): every input with a `stateKey` becomes `set:<key>` (Slider /
  NumberInput → number with min/max, Toggle → boolean, TextInput / ColorPicker → text,
  Select / RadioGroup → choice with options); every `Button` with an action becomes
  `press:<nodeId>`; seeded state values no input writes are still settable. Values
  pass through `coerceValue`: numbers parse `"6.25%"` or `"$90,000"` and are **clamped**
  to the control's min/max, booleans accept on/off/yes/no, choices must match an
  option. `press` dispatches the Button's own declarative action.
- **Sandbox actions** are opt-in. Inside the iframe, the **genui bridge**
  (`GENUI_BRIDGE` in `components.tsx`, injected into both `CustomWidget` and
  `ReactArtifact` documents) defines `window.genui.expose({ name: { description, params,
  run } })`. Each call posts the action catalog to the parent (`__genuiActions`); the
  host side (`useFrameBridge`) accepts messages only from that frame's `contentWindow`
  and registers the actions (max 30 per frame; names, descriptions and params are
  clipped) as `call:<name>` controls. Running one posts `{ __genuiCall: { id, name,
  args } }` to that frame; the bridge accepts calls only from `window.parent`, runs the
  function **inside the sandbox**, and replies `__genuiResult` with a short string
  (≤300 chars). No reply within 4 s → `ok:false`.

`GeneratedApp` attaches its state to the hub on every spec change and detaches on
unmount; iframes unregister their actions when they unmount.

### Chat

The **"Talk to it"** panel (`src/client/shell/Conversation.tsx`) sends
`POST /api/chat` with `{ message, spec, readable, controls, history }` — the screen
text (DOM text + control digest + iframe digests), `controlHub.controls()`, and the
last 8 turns. `runChat` (`src/server/chat.ts`) makes **one structured Grok call**
(schema `ui_chat`: `reply`, `acts`, `change: none|refine|generate`, `instruction`) that
decides to:

1. **answer** from the screen text only;
2. **operate** — return `acts`, which the server sanitizes and filters to control ids
   the browser reported; the browser runs them through `controlHub.run()` and logs each
   result in the thread (no regeneration);
3. **rebuild** — `refine` (generator.refine with the model's instruction) only when the
   request changes design or structure; `generate` only for something entirely
   different. A refine that returns an unchanged spec, or a generate that returns the
   degraded notice, is reported as `ok:false` ("I couldn't rebuild it that way") rather
   than claimed.

**Grounded confirmation.** That first reply is written before the acts run, so it can
only say what was asked. When a turn had acts, the client runs them, waits ~0.9 s for
the screen to settle (sandbox text digests post within 0.7 s), and calls
`POST /api/chat/confirm` with the per-act results and the refreshed screen text. A fast
model (`CHAT_CONFIRM_MODEL`, else `JEV_JUDGE_MODEL`) restates what actually happened,
including failures and outcomes the app reported ("pause() → not running" becomes "the
game isn't running", and a changed bill comes back with the new total read off the
screen). If that call fails, code summarizes the results instead. Without a Grok
generator, a chat message falls back to a plain refine (and the stub reports that no
model is connected).

### Voice — Grok speech-to-speech

A WebSocket at `/voice` (`src/server/voice-grok.ts`) bridges the browser to
`wss://api.x.ai/v1/realtime?model=grok-voice-latest` (voice `eve` by default). The
browser streams 16 kHz PCM mic audio (`src/client/voice/audio.ts`); the session asks
Grok for 24 kHz PCM back, plus transcripts. The agent has four function tools
(`src/server/voice-tools.ts`), returned as `function_call_output`:

- `read_ui` — a **live round-trip**: the server sends `readRequest` and the browser
  answers with the *current* screen text **and** the controls list, so the agent
  observes its own edits (falls back to the last context after 2.5 s).
- `act_ui` — operate the UI: acts are sanitized, sent as `actRequest`, re-sanitized and
  run by `controlHub` in the browser, and the per-act results come back as `actResult`
  (5 s timeout → `ok:false`). `ok` is true only if every act succeeded.
- `refine_ui` / `generate_ui` — edit or replace the UI; `refine_ui` reports `ok:false`
  on a no-op instead of claiming success.

The voice system prompt tells the agent to prefer `act_ui` whenever a control fits and
to rebuild only for design/structure changes. Chat and voice share **one thread**:
while voice is live, typed messages go to the voice agent (as a text conversation item)
and it answers aloud; when voice stops, its final transcript lines are archived into the
thread. A dropped Grok socket reconnects as a new session (up to three tries). Gemini
Live (`VOICE_PROVIDER=gemini`, `src/server/voice-gemini.ts`) keeps `read_ui` /
`refine_ui` / `generate_ui` (no `act_ui`) and still persists a resumption handle; that
mechanism is not in the current Grok speech-to-speech docs.

The iframe text digest is throttled (≤ one post per 700 ms) with a **trailing** post,
so the last change after a burst is not dropped and `read_ui` does not go stale.

### Refinement and multi-screen

- **Refine:** `/api/stream` with `{ prompt, spec }`, a chat `refine`, or voice
  `refine_ui` all call `generator.refine`, which returns the full updated spec (or the
  original spec when the model's output degraded).
- **Multi-screen (plan→expand):** prompts that read as multi-screen
  (deck/onboarding/wizard/flow/…) route to `generator.generateApp`, which plans 2–5
  screens, generates each independently (parallel — sidesteps the per-response token
  ceiling and raises per-screen quality), **namespaces** each screen's state keys / ids
  / bind identifiers (`s{i}_…`) to prevent cross-screen collisions, then assembles a
  `Tabs` shell (re-validated). Screens are often self-contained `ReactArtifact`s, in
  which case there's no shared state to clash. Jev routing is not applied on this path.

### Generative theming

A spec may include `theme` (palette hex + a Google Font), which the prompt asks the
model to derive from its design brief. `GeneratedApp` maps it to scoped `--gp-*` CSS
variables on the generated section only — it no longer tints the page body or the
playground shell (the registry's Tailwind tokens are var-driven, so **no per-component
change**). A deterministic **WCAG contrast pass** flips illegible text to black/white,
derives a guaranteed-legible `muted`, and flips on-accent button text by luminance — so
any model-chosen palette stays readable. Sandboxed lanes theme themselves.

### The shell

`src/client/App.tsx` + `src/client/shell/`: a **landing** page (`Landing.tsx`: hero,
composer, "how it works", a 6-card example gallery) and a **workspace** — the canvas
(design-brief header, build log, the generated UI, "View spec") beside the "Talk to it"
panel (Jev decision card, one thread for chat + voice, try-it chips from the example's
`tryIt` phrases, a composer with a mic toggle). Shell fonts are Geist / Instrument Serif
/ Geist Mono; tokens live in `src/client/index.css`.

---

## 9. Safety model (summary)

| Surface | What runs | Why it's safe |
|---|---|---|
| Registry components | pre-written React, audited | model only picks types + props; no codegen |
| `bind` expressions | `expr-eval-fork` arithmetic/logic | sandboxed parser, not JS; no `eval`/`new Function` |
| `CustomWidget` | model-authored HTML/JS | isolated iframe, `allow-scripts` only (no same-origin); CSP `connect-src 'none'` |
| `ReactArtifact` | model-authored React+Tailwind | isolated iframe (no same-origin); CSP limits scripts to the CDNs and `fetch` to the CDNs + open-meteo, coingecko, github |
| Artifact actions (`call:`) | model-authored functions | run **inside** the sandbox; the parent only posts a named call + JSON args to that one frame; the bridge accepts calls only from `window.parent`; the host accepts catalogs/results only from that frame; results are short strings |
| Registry acts (`set:` / `press:`) | agent-chosen values | id regex + max 12 acts; chat filters to control ids the browser reported; values coerced and clamped to min/max/options; `press` only fires the Button's own declarative action |
| Chat / voice screen text | page text sent to the model | prompts state that screen text is data, not instructions (prompt-level only) |
| Jev router | classifier answers → code policy | injection or contradictory prompts are **held** and nothing is built; thresholds and policy are code, not model text |
| Spec ingestion | server `validateSpec` | normalizes/repairs; unknown types degrade gracefully; design brief clipped |
| Request bodies | Express JSON parser | malformed JSON → JSON 400 (no HTML stack trace); per-IP rate limit and prompt length cap on generate/stream/decide/chat |

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
told), `validate.ts` (`KNOWN_TYPES`), `control.ts` (`INPUTS`, which inputs become
controls) and `jev/router.questions.ts` (`REGISTRY_NAMES`, what Jev compares against).

---

## 11. File map

```
src/
  shared/
    spec.ts                 # UISpec / UIDesign / UINode / UIAction / UITheme / Example
    control.ts              # UIControl / UIAct / UIActResult, chat types, describeControls, sanitizeActs
    toolbox.ts              # Jev Decision / DecisionEnvelope types, design-system ids
  server/
    index.ts                # Express: /api/health, /api/examples, /api/generate, /api/stream (SSE),
                            #   /api/decide, /api/chat, JSON-400 handler, /voice (WS), /docs, static
    config.ts               # env parsing (generator, voice, Grok, Gemini, TypeSafe, deciderChoice)
    toolbox.ts              # decideToolbox(): Jev or Grok judge → policy → DecisionEnvelope
    jev/
      client.ts             # askJev(): POST {TYPESAFE_BASE_URL}/v1/systemone
      grok-judge.ts         # askGrokJudge(): Grok answers the same questions (JEV_JUDGE_MODEL)
      policy.ts             # routeToolbox() (route/ask/hold) + explain() "why" lines
      router.questions.ts   # the typed questions, thresholds T, ask copy, REGISTRY_NAMES
    route-hints.ts          # Jev route → ROUTING block appended to the user turn
    chat.ts                 # runChat(): one structured Grok call → answer / acts / refine / generate
    grok-json.ts            # shared one-shot structured Grok call (chat, judge)
    voice.ts                # /voice provider switch
    voice-grok.ts           # Grok speech-to-speech (default); readRequest/actRequest round-trips
    voice-gemini.ts         # Gemini Live, VOICE_PROVIDER=gemini
    voice-tools.ts          # read_ui / act_ui / refine_ui / generate_ui + VOICE_SYSTEM
    grok.ts                 # Grok Responses API generator (design-first schema)
    gemini.ts               # Gemini generator (opt-in)
    generator.ts            # Generator selection + stub
    types.ts                # Generator interface
    prompt.ts               # system instruction: components, design brief, interaction, examples
    validate.ts             # validateSpec(): normalize/repair model output (+ normDesign, theme)
    spec-build.ts           # echo/degraded specs, multi-screen assembly + namespacing
    screen-route.ts         # isMultiScreenPrompt()
    json.ts / limit.ts      # balanced-brace JSON extraction / per-IP rate limiter
    examples.ts             # gallery example *prompts* with lane + tryIt (no canned specs)
    openapi.ts              # OpenAPI 3 doc (served at /docs, /openapi.json)
  client/
    App.tsx                 # shell + routeThenBuild (decide → stream), chat send, voice wiring
    shell/Landing.tsx       # hero, composer, how it works, example gallery
    shell/Conversation.tsx  # "Talk to it": Jev decision card, thread, try-it chips, composer + mic
    api.ts                  # streamSpec() SSE parser, decide(), chat(), generate(), fetchExamples()
    index.css               # shell design tokens (--gp-*)
    voice/                  # audio.ts (mic/playback), useLiveVoice.ts (read/act requests), transcript.ts
    engine/
      components.tsx        # registry (A) + CustomWidget (B) + ReactArtifact (C), CSPs, genui bridge,
                            #   text digest, useFrameBridge
      control.ts            # controlHub: registry + sandbox controls, coerceValue, run()
      state.ts              # reactive store, safe expression eval, action reducer
      snapshot.ts           # control digest for the readable screen text
      GeneratedApp.tsx      # renders a UISpec; owns state; attaches to controlHub; applies theme
scripts/
  e2e.mjs                   # live: Jev route, design brief, chat operating registry + sandbox actions
  voice-agent.mjs           # live voice: read_ui → act_ui → read_ui, no rebuild
  live-grok.mjs             # live Grok gate (generate, UI, one voice turn)
  shot.mjs                  # README screenshot
  jev-eval.ts               # evaluate/tune Jev thresholds on jev-prompts.json (tune / held-out)
  judge-speed.ts            # time the Grok judge per model
```

Unit tests (`npm test`, 75 tests): `src/server/*.test.ts` (incl. `chat.test.ts`,
`toolbox.test.ts`), `src/server/jev/*.test.ts`, `src/client/engine/*.test.ts` (incl.
`control.test.ts`), `src/client/voice/*.test.ts`.

---

## 12. Honest limitations

- **Generation requires a model.** Everything is model-authored — there are no
  canned specs. Without a key the playground loads but can't generate (it shows a
  notice); with `XAI_API_KEY` it generates live across the toolbox.
- **A first build is slow:** a full spec typically takes ~30–90 s with `grok-4.7`, and
  the SSE reveal only starts once the whole spec exists.
- **Lane A is a fixed vocabulary.** New component *types* can't be invented in the
  safe lane; unbounded novelty only via the sandbox.
- **Binds are numeric/boolean** (expr-eval), not arbitrary JS — intentional.
- **Top-level streaming is coarse** for single-root specs (see §7).
- **The Grok judge is not calibrated like Jev.** Without `TYPESAFE_API_KEY` its
  probabilities are Grok's own estimates run through thresholds tuned on Jev; the
  decision card labels the source.
- **Jev is enforced by the client, not by `/api/stream`.** The UI calls `/api/decide`
  first; a direct API caller can skip it. Low-confidence and router-error holds fall
  through to an unrouted build. The decision's `checks` (axe-core, Impeccable scan, …)
  are listed in the "why" lines but are not run by the playground.
- **Sandboxed apps must opt in to be operable.** An artifact that doesn't call
  `genui.expose` can only be read (text digest) or rebuilt, not operated.
- **Chat confirmation costs a second call.** A turn with acts makes one decision call
  and one short confirmation call (~1–2 s on the fast model), and the confirmation is
  only as good as the screen text and the results the app returned.
- **Gemini paths are thinner:** Gemini Live has no `act_ui`, and with `GENERATOR=gemini`
  chat messages are treated as refines.

---

## 13. Configuration

`.env` (copy from `.env.example`):

```
PORT=8080
GENERATOR=grok            # or "stub" or "gemini"
XAI_API_KEY=…             # required for grok text, chat, the Grok judge and voice
GROK_MODEL=grok-4.7
GROK_REASONING_EFFORT=low
GROK_VOICE_MODEL=grok-voice-latest
STREAM_STAGGER_MS=110     # per-node SSE stagger (visual pacing)

TOOLBOX_DECIDER=auto      # auto | jev | grok — auto = Jev with a TypeSafe key, else Grok judge, else none
TYPESAFE_API_KEY=         # enables Jev (server-side only)
# TYPESAFE_DEFAULT_MODEL=jev-1.13.0
# TYPESAFE_TIMEOUT_MS=4000
JEV_JUDGE_MODEL=grok-4.20-0309-non-reasoning   # Grok judge model (code default: GROK_MODEL)
```

An explicit `TOOLBOX_DECIDER=jev` without a key resolves to `none` (every decision
holds) rather than silently using Grok. `/api/health` reports `generator`, `model`,
`voice`, `voiceModel` and `decider`.

Run: `npm run dev` (Vite :5173 + server :8080) · `npm start` (prod) ·
`docker compose up --build`. API docs at `/docs`.

---

## 14. The toolbox router (Jev)

**Jev** is TypeSafe's typed decision model. Instead of asking a model to write a plan,
the server asks it **typed questions** about the prompt and lets **code** turn the
answers into a decision. `decideToolbox()` (`src/server/toolbox.ts`) is the single seam;
`POST /api/decide` returns a `DecisionEnvelope`
(`{ prompt, decision, source, model, ms, why, error? }`).

**Backends** (`deciderChoice` in `config.ts`):
- **Jev** — `askJev()` posts `{ model, state: { prompt, registry }, questions }` to
  `{TYPESAFE_BASE_URL}/v1/systemone` with a Bearer key (model pinned to `jev-1.13.0`,
  4 s timeout). The key never reaches the client.
- **Grok judge** — without a TypeSafe key, `askGrokJudge()` asks Grok the **same**
  questions in one structured call (schema `toolbox_judgments`), normalizes the
  probabilities and returns the same answer shapes, so the policy runs unchanged. It
  uses `JEV_JUDGE_MODEL` (Docker/`.env.example` default
  `grok-4.20-0309-non-reasoning`, ~2 s; `scripts/judge-speed.ts` times it).
- A configured backend that errors produces a `jev_error` hold; Jev never silently
  falls back to Grok.

**The questions** (`router.questions.ts`, 14): `design` (choice: `editorial_serif`,
`ops_console`, `soft_consumer`, `unclear`), `render` (choice: `registry`,
`sandboxed_react`), `specificity` (score 0–2), and yes/no probabilities for
`need_stepper`, `need_table`, `need_drawer`, `need_citations`, `need_approval`,
`async_data`, `miss_audience`, `miss_data`, `miss_action`, `injection`, `contradictory`.

**The policy** (`routeToolbox` in `policy.ts`, thresholds `T` tuned with
`scripts/jev-eval.ts` on the tune split of `scripts/jev-prompts.json`):
1. Malformed or missing answers → **hold** (`jev_error`).
2. `injection` ≥ 0.5 → **hold** (`unsafe_or_injection`); `contradictory` ≥ 0.55 →
   **hold** (`contradictory`). Checked on every pass.
3. Not yet answered: low specificity (< 1.4) with a likely missing audience / data /
   action (≥ 0.6) → **ask** that one slot; an unclear style (best pick < 0.6 or
   P(unclear) ≥ 0.5) → **ask** the audience. Ask copy is fixed code text.
4. After one answer it never asks again: a style still below 0.4 → **hold**
   (`low_confidence`).
5. Otherwise **route**: components at ≥ 0.6 (stepper, table, drawer, citation viewer;
   approval card from 0.35). Lane is `sandboxed_react` when a needed component is one
   the registry can't draw, or when P(registry) < 0.7; else `registry`. The best
   concrete design system becomes the style family.

`explain()` writes the plain-language "why these tools" lines from the evidence; the
decision card in the "Talk to it" panel shows them with the source (*Jev · TypeSafe* or
*Grok judge (Jev stand-in)*).

**How the client uses it** (`routeThenBuild`):

| Outcome | What happens |
|---|---|
| route | `/api/stream` with `lane`, `components`, `style` → ROUTING block (§6) |
| ask | the decision card shows the one question; an answer re-decides with `answered=true`, "Just build it" streams unrouted |
| hold: injection / contradictory | stop — nothing is built |
| hold: low confidence / router error, or `/api/decide` fails | stream unrouted; the model chooses the tools |

Gallery examples call decide with `answered=true`, so curated prompts route or hold but
never ask. Jev decides **how** a prompt is built (lane, structural pieces); it never
fixes the look — the style family is only a hint to the design brief.
