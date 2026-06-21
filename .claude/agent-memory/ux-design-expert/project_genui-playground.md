---
name: project-genui-playground
description: What the genui-playground demo is, who it's for, and its core UX flows
metadata:
  type: project
---

`genui-playground` is a **public demo of how generative UI can be done**. Audience is a first-time stranger (likely technical/recruiter/peer evaluating the builder's work), not a returning user.

Core flow: type a sentence → a model generates a working interactive UI live (streams in with skeleton + build-log + progress bar + provenance badge) → refine it via a chat "Refine" bar OR via **Gemini Live voice** (a floating panel where Gemini hears you, reads the rendered DOM, and rewrites the UISpec in its own voice). Plus: gallery of example *prompts* (not canned UIs), "View spec" JSON peek, "Surprise me".

Architecture: nothing hard-coded. A "hybrid engine" — whitelisted registry components (`src/client/engine/components.tsx`), a sandboxed CustomWidget iframe, and a freeform React+Tailwind lane (`ReactArtifact`, CDN-loaded, sandboxed iframe). Generation streams over SSE (`src/client/api.ts` `streamSpec`); voice runs over a `/voice` WebSocket (`src/client/voice/useLiveVoice.ts`).

**Why:** The whole point is to *show off* that "the AI built this, live." The streaming reveal and provenance are the product, not chrome.

**How to apply:** Judge UX against the first-time-stranger goal — does a stranger immediately understand the AI built it live, and can they discover Voice/refine/spec without help? The shell lives in `src/client/App.tsx`; voice panel in `src/client/voice/VoicePanel.tsx`.
