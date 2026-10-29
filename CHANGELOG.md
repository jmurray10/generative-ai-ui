# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Default text generation is Grok `grok-4.7` through the xAI Responses API
  (`openai` SDK, `baseURL` `https://api.x.ai/v1`, JSON schema output). Set
  `XAI_API_KEY`. `GENERATOR=gemini` keeps the previous Gemini path.
- Default voice is Grok speech-to-speech (`grok-voice-latest` on
  `wss://api.x.ai/v1/realtime`, voice `eve`) with the same `read_ui` /
  `refine_ui` / `generate_ui` tools. `VOICE_PROVIDER=gemini` keeps Gemini Live,
  including its session-resumption handle.
- Bind expressions use `expr-eval-fork` instead of unmaintained `expr-eval`.
- PostCSS is 8.5.32, which closes the source-map path traversal advisory in 8.4.x.
- CustomWidget iframes send a Content-Security-Policy that blocks network access.
  Generate and stream routes are rate-limited. Upstream error text is no longer
  returned to the browser.

### Fixed
- ReactArtifact documents allow `'unsafe-eval'` and `blob:` so Babel and the
  import lane can run. The frame stays an opaque-origin sandbox, and
  `connect-src` is limited to the CDN hosts plus the documented public data APIs.
- Gauge and progress readouts use a consistent number format. Currency symbols
  in `suffix` render as a prefix. A gauge past its scale still shows the real value.
- Typed slider and number values outside the model min/max/step are kept, and
  the slider track widens to include them.
- When a model response contains more than one JSON value, generation keeps the
  most complete one and logs what it dropped.
- `scripts/live-grok.mjs` uses the `ws` package, so the live gate runs on Node 20
  (no global `WebSocket`) and on Node 22.
- Voice transcripts update one line per utterance. Cumulative user text such as
  "What is the" → "What is the current count?" no longer stacks duplicate lines.

### Added
- `npm test` (node:test) for spec parsing, provider selection, the voice event
  map, and the expression sandbox. CI runs it. `scripts/live-grok.mjs` is the
  opt-in live Grok browser check and is not part of CI.

## [0.1.0] - 2026-06-20

### Added
- Initial public release: type a sentence and a working, interactive UI builds itself —
  no upload, no domain setup, no account. Nothing is hard-coded; the gallery is just
  example prompts.
- **Three-lane toolbox** the model chooses from per node:
  - **Lane A — registry:** ~28 audited React components (layout / display / charts /
    inputs) filled by the model, with a reactive state map whose `bind` expressions run in
    a safe parser (`expr-eval`, no `eval`).
  - **Lane B — CustomWidget:** arbitrary HTML/JS in an isolated
    `<iframe sandbox="allow-scripts">` — canvas visuals and games.
  - **Lane C — ReactArtifact:** freeform React + Tailwind transpiled and run in a sandboxed
    iframe, with `import` of real npm packages (recharts, three, framer-motion, dnd-kit, …)
    and `fetch()` of public CORS APIs for live data.
- **Live generation** via Gemini (`@google/genai`, `gemini-3.5-flash`) behind a `Generator`
  interface, with robust balanced-brace JSON extraction; runs offline in `stub` mode with
  no key.
- **Streaming + refine:** SSE `/api/stream` reveals the UI node-by-node; a chat refine bar
  edits the live spec.
- **Multi-screen:** deck / onboarding / wizard prompts are planned → expanded into a tabbed
  app, each screen generated independently with state namespaced to avoid collisions.
- **Generative theming:** the model emits an optional `theme` (palette + Google Font); a
  deterministic WCAG contrast pass flips illegible text and derives a legible muted tone so
  any palette stays readable.
- **Voice (Gemini Live):** a `/voice` WebSocket agent with `read_ui` / `refine_ui` /
  `generate_ui` tools — live read-back round-trip, session resumption + transparent
  reconnect, and sandbox text digests so it can "see" inside artifacts.
- **API + docs:** Swagger UI at `/docs` (raw spec at `/openapi.json`), `ARCHITECTURE.md`,
  `LLM.md`, Docker Compose one-command run, and CI (typecheck + build).
