# LLM & Agent Model

How language models are used in GenUI Playground. For system architecture see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## TL;DR — is this an agent?

**It has two distinct model paths, and they sit on opposite sides of the line.**

- **Generation (`/api/generate`, `/api/stream`)** — turning a prompt into a UI — is **not**
  agentic. It is a **single structured-output call**: the model receives a system prompt +
  the user's sentence and returns one `UISpec` JSON object. No loop, no tool use, no
  planning cycle. By the classical (Russell & Norvig) definition it is a **simple reflex
  agent**: percept (the prompt) → action (a spec) via a fixed program. By the modern
  "agentic AI" definition it is just a constrained generate call. The default model is
  Grok (`grok-4.7` on the xAI Responses API). `GENERATOR=gemini` keeps the previous call.
- **Voice (`/voice`)** — Grok speech-to-speech — **is** agentic in the modern sense: a
  real **perceive → decide → act → observe loop**. It streams microphone audio, decides to
  call `read_ui` / `refine_ui` / `generate_ui`, acts on the live screen, observes the tool
  result, and continues the conversation. `VOICE_PROVIDER=gemini` keeps Gemini Live.

Precise statement: **a reflex-style UI generator wrapped by an agentic voice loop.** The
interesting engineering is keeping the powerful-but-unbounded model output *safe* and
*legible* on the way to the DOM.

## Path 1 — generation (reflex)

One call per request. The default client is the OpenAI SDK pointed at xAI:

```
client.responses.create({
  model: GROK_MODEL,              // default grok-4.7
  instructions: SYSTEM_PROMPT,
  text: { format: { type: 'json_schema', name: 'ui_spec', strict: false, schema } },
  reasoning: { effort: 'low' },   // grok-4.7's own default is high
  max_output_tokens: 16384,
})
```

`GENERATOR=gemini` still uses `@google/genai` `generateContent` with
`responseMimeType: 'application/json'` and `GEMINI_MODEL` (default `gemini-3.5-flash`).

- **The model decides only the UISpec.** Python/TypeScript control flow decides everything
  else — which endpoint ran, whether to stream, how to validate, how to render.
- **The system prompt** (`src/server/prompt.ts`) pins the model to the exact component
  vocabulary the client registry implements, the reactive-state conventions, and the safe
  expression subset, then shows worked examples. Anything outside that vocabulary renders
  as an "Unknown component" placeholder rather than executing.
- **Refine** (`/api/stream` with a prior spec) is still one call: current spec + instruction
  → a new spec. No iterative self-correction loop.

### Multi-screen — a fixed pipeline, not a planning loop

A deck / onboarding / wizard prompt routes to `generateApp`, which is a **deterministic
two-stage pipeline**, not autonomous planning:

1. **Plan** — one call returns `{ title, screens: [{ title, prompt }] }`. The *model* picks
   the screens, but it does so in a single shot.
2. **Expand** — each screen's prompt is generated **independently** (`Promise.all` over the
   same single-call generator), then assembled into a `Tabs` node with per-screen state
   namespacing.

The orchestration (fan-out, namespacing, assembly, `validateSpec`) is plain code. The model
never decides "what to do next" — it only fills in content.

## Path 2 — voice (agentic loop)

The default voice path is Grok **speech-to-speech** (`wss://api.x.ai/v1/realtime`, model
`grok-voice-latest`, voice `eve`). As of the Oct 10, 2026 docs, that alias routes to
`grok-voice-think-fast-2.0`. It runs a tool-calling loop over a WebSocket. The model is
given three tools and a system instruction telling it to *act, then narrate*:

| Tool | Effect |
| --- | --- |
| `read_ui` | Round-trips to the browser for the **current** on-screen text, so the agent answers from real values — never invented data. |
| `refine_ui` | Edits the current screen (delegates to the same generator as `/api/stream`). |
| `generate_ui` | Replaces the screen with a brand-new UI. |

This is the part that is an agent in every sense: it perceives (audio + live UI), chooses a
tool, the world changes (the React tree re-renders), it observes the result, and it
continues. A dropped Grok socket opens a fresh session (up to three tries). The current
speech-to-speech docs do not describe Gemini Live's resumption handle; that behavior
stays on `VOICE_PROVIDER=gemini`. Standalone `/v1/stt` and `/v1/tts` exist; this app
uses the combined realtime socket because the agent needs mic audio, spoken replies,
and tools on one connection.

## Safety — why unbounded output is still safe

The model can emit freeform code (Lanes B and C), so the trust boundary matters:

- **Registry bindings** are evaluated by a **safe expression parser** (`expr-eval-fork`) over a
  flat state object — never `eval`, no JS access. The expression subset is arithmetic +
  comparisons + ternary + a small function whitelist. The original `expr-eval` package is
  unmaintained and affected by CVE-2025-12735 and CVE-2025-13204.
- **CustomWidget / ReactArtifact** code runs in an isolated
  `<iframe sandbox="allow-scripts">` with **no same-origin access** — it cannot read the
  parent page, cookies, or the shared app state. It talks to the host only through a
  narrow `postMessage` text digest (so voice can "see" inside it).
- **Server-side `validateSpec`** rejects malformed specs before they reach the client.

The model proposes; the harness disposes. That separation — powerful generation behind a
fixed, audited rendering boundary — is the whole design.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GENERATOR` | `grok` | `grok` (default), `gemini`, or `stub` (offline notice). |
| `XAI_API_KEY` | — | Required for Grok text and Grok voice. |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | Responses API and realtime base. `https://us.api.x.ai/v1` keeps inference in the US. |
| `GROK_MODEL` | `grok-4.7` | Text model. |
| `GROK_REASONING_EFFORT` | `low` | `low`, `medium`, `high`, or `xhigh`. |
| `VOICE_PROVIDER` | Grok when `XAI_API_KEY` is set, else off | `grok`, `gemini`, or `off`. |
| `GROK_VOICE_MODEL` | `grok-voice-latest` | Speech-to-speech alias. Oct 10, 2026 docs route it to `grok-voice-think-fast-2.0`. |
| `GROK_VOICE` | `eve` | Built-in voice id. |
| `GROK_VOICE_REASONING` | `none` | `none` or `high`. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | — | Only for `GENERATOR=gemini` / `VOICE_PROVIDER=gemini`. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini text model. |
| `LIVE_API_MODEL` | `gemini-2.5-flash-native-audio-preview-12-2025` | Gemini Live model. |
| `LIVE_API_VOICE` | `Kore` | Gemini Live voice. |
| `STREAM_STAGGER_MS` | `110` | Delay between streamed nodes (build-in effect). |
| `RATE_LIMIT_PER_MIN` | `30` | Per-IP cap on `/api/generate` and `/api/stream`. |

No key → the app still loads and shows a "connect a model" notice; nothing is hard-coded.
