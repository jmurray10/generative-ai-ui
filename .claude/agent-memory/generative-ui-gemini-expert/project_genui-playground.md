---
name: project-genui-playground
description: GenUI Playground — hybrid generative-UI demo (3 lanes, SSE, Gemini Live voice). Confirmed SDK versions, model ids, and architecture facts as of 2026-06.
metadata:
  type: project
---

A public DEMO of hybrid generative UI (explicitly not a production product). A person describes a UI in natural language; Gemini emits output the client renders across three "lanes":
- Lane A: declarative JSON spec over a ~28-component whitelisted React registry + reactive state (`expr-eval` safe binds, declarative actions). `src/client/engine/{components.tsx,state.ts,GeneratedApp.tsx}`.
- Lane B: `CustomWidget` — vanilla JS/HTML/CSS in a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin).
- Lane C: `ReactArtifact` — model-written React+Tailwind, Babel-transpiled in a sandboxed iframe. Classic runtime (UMD React, no imports) or Module runtime (esm.sh import map). Module map (as of 2026-06) now includes recharts, d3, three, @react-three/fiber+drei, @dnd-kit/core+sortable+utilities, gsap, react-markdown, date-fns, canvas-confetti, clsx, zustand, react-icons/ (trailing-slash subpath), plus the original react/react-dom/lucide-react/hls.js/framer-motion.

**Confirmed facts (verify before acting — these drift):**
- SDK: `@google/genai` declared `^1.39.0`, installed `1.52.0` (checked node_modules). New SDK shape: `ai.models.generateContent({model, contents, config})`, `ai.live.connect(...)`.
- Text gen model: `gemini-3.5-flash` (env `GEMINI_MODEL`). Live model: `gemini-2.5-flash-native-audio-preview-12-2025` (env `LIVE_API_MODEL`), voice `Kore`.
- Gen config: `responseMimeType:'application/json'` + regex/balanced `extractJSON` — NOT `responseSchema`. temp 0.4, maxOutputTokens 16384. `src/server/generator.ts`.
- Validation/repair: `src/server/validate.ts` `validateSpec()` — normalizes, keeps unknown types (client renders placeholder), throws only on irrecoverable top-level shape. No semantic repair (unbound Stat.value, unseeded state, missing types) and no model re-prompt loop.
- SSE: server generates FULL spec then re-emits node-by-node with stagger. Not true token streaming.
- Voice: WS `/voice` bridges browser <-> Live session. Tools: `read_ui`, `refine_ui`, `generate_ui`. Audio 16k PCM in / 24k PCM out. `src/server/voice.ts`, `src/client/voice/*`.

**State model (load-bearing for multi-screen):** ONE flat shared `StateMap` for the whole generated app (`src/client/engine/state.ts`). `reset` action replaces the ENTIRE state with `initialState`. So a `generateApp` Tabs assembly that `Object.assign`-merges per-screen `initialState` shares one namespace across all tabs — colliding keys (count/bill/etc.) cross-talk, and any screen's reset nukes all screens.

**Multi-step gen (as of 2026-06):** `GeminiGenerator.generateApp()` does plan→expand→assemble: 1 plan call → `{title,screens:[{title,prompt}]}` (2-5), `Promise.all` per-screen `generate`, merges initialState via Object.assign, wraps each screen's `tree` as a `Stack`'s children under one `Tabs`. Returns a HAND-BUILT spec object that BYPASSES `validateSpec` (only the per-screen `generate` calls are validated). Routed by `APP_LIKE` regex in `src/server/index.ts`. Falls back to `generate` if <2 screens or on error.

**Known live-voice gap — NOW PARTIALLY ADDRESSED (2026-06):** `updateContext` IS now wired (VoicePanel calls it on `specVersion` change) and `read_ui` does a live round-trip (`requestRead`) reading current on-screen `innerText`. Sandboxed-iframe blindness closed via a `TEXT_POSTER` injected into both CustomWidget+ReactArtifact docs that postMessages `{__artifactText}` (throttled ~700ms, MutationObserver) to a `data-artifact-text` attr; `voiceContext()` in App.tsx merges those digests into `readable`. Caveat: postMessage uses `"*"` target origin and the parent listener checks `e.source` (frame identity) but not `e.origin`.

**Theme token wiring (confirmed correct 2026-06):** `Button` solid uses `text-accent-ink`; `accent.ink` maps to `--gp-on-accent` in tailwind.config.js (line 18), which GeneratedApp sets via the WCAG on-accent flip. NOT a bug — verified end-to-end. (Don't re-flag.)

**Known review findings (final pass 2026-06-19) — these are accepted/by-design unless noted:**
- refine() inlines full spec JSON into the prompt; a large multi-screen/ReactArtifact base spec can exceed maxOutputTokens(16384) on the RETURN → truncated JSON → refine silently returns the ORIGINAL spec. Also express.json limit is 1mb (POST /api/stream refine body). Highest-value real bug.
- generateApp per-screen failures are swallowed: each screen calls generate(), which catches and returns an echoSpec card. A failed screen becomes a "Couldn't build that one" tab with no surfaced error. Plan call also has no JSON repair path beyond the outer try.
- Chart safeColor() hardcodes a DARK-canvas luminance floor (<0.16 → palette). Under a model-emitted LIGHT theme, dark chart colors get swapped to bright palette. Cosmetic.
- voiceContext()/CustomWidget+ReactArtifact postMessage uses target "*" and parent verifies e.source (frame identity) but not e.origin — sandboxed (no same-origin) frames have opaque "null" origin so a strict origin check is awkward; source check is the practical guard. Low risk (no secrets posted).

Container already runs on :8080; app builds clean. REVIEW tasks here are read-only by default — do not start servers/Docker.
