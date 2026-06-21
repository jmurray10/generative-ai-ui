---
name: genui-voice-agent
description: PEAS analysis of the GenUI Playground's two agents (generator + Gemini Live voice); key rationality gaps found in the code
metadata:
  type: project
---

The GenUI Playground (`genui-playground/`) is a demo of hybrid generative UI with TWO agents worth a PEAS lens:

- **Agent A (Generation)** — `src/server/generator.ts` + `prompt.ts`. NL prompt -> declarative `UISpec` JSON. Picks per-node among three "tools/lanes": Lane A whitelisted React registry (declarative, safe, shares reactive state), Lane B `CustomWidget` (sandboxed vanilla JS iframe), Lane C `ReactArtifact` (model-written React+Tailwind, esm.sh imports, sandboxed iframe). Output is repaired by `validateSpec` (unknown types kept as graceful placeholder). Stub generator does NOT generate (returns echo card) — generation requires a Gemini key.
- **Agent B (Voice)** — `src/server/voice.ts`. Gemini Live native-audio session over a `/voice` WebSocket. Tools: `read_ui` (returns cached `readable` string), `refine_ui`, `generate_ui` (both delegate to the generator and push a new spec to the browser).

**Rationality gaps found in the code (load-bearing):**
1. **Stale percepts / no observe-before-act loop.** `useLiveVoice.ts` sends `spec`+`readable` only on `init` (mount). `updateContext` exists in the hook but is NEVER called — dead code. After the voice agent itself calls `refine_ui`/`generate_ui`, the server updates `currentSpec` but `readable` is only refreshed if the client sends a `context` message, which it never does. So `read_ui` returns the on-screen text from session start, going stale after the first change.
2. **Partial observability of the two most powerful lanes.** `read_ui` returns `root.innerText` of the parent `<section aria-label="Generated interface">` (App.tsx voiceContext). Lanes B and C render in `sandbox="allow-scripts"` iframes WITHOUT `allow-same-origin` (components.tsx ~L465 and ~L567), so their inner text is unreachable. For any artifact/widget UI the agent is effectively blind — it sees an empty/near-empty string.
3. **No explicit performance measure.** Only a terse system prompt ("keep replies short", "never invent data"). No success signal, no verification that a refine actually applied the requested change.
4. **Weak uncertainty/error handling.** `runTool` catches and returns `{ok:false,error}` but the system prompt gives no recovery policy; `refine` on failure silently returns the unchanged spec, so the agent may report success on a no-op.

**Recommended architecture framing:** Agent A = goal-based (single-shot, sequential only via refine). Agent B = should be a model-based, utility-leaning agent BUT is implemented closer to a reflex-over-tools agent because it lacks a refreshed world model. Highest-impact fix: wire `updateContext` to fire after every spec change (and after the agent's own tool calls), or have `read_ui` pull fresh text live, plus expose artifact/widget text out of the sandbox via postMessage.
