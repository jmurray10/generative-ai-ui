---
name: peas-voice-ui-pattern
description: Reusable PEAS template + classification for a voice agent that reads and edits an on-screen generated UI via tool calls
metadata:
  type: reference
---

PEAS template for a **voice-over-generated-UI agent** (e.g. Gemini Live driving a generative UI). See [[genui-voice-agent]] for the concrete instance.

- **Performance measure:** task success per spoken turn (did refine/generate produce the asked-for change?), answer faithfulness to actual on-screen data (no hallucination), latency to first audio, turn-economy (fewest tool calls), conversational naturalness, safety (no destructive replace when an edit was meant).
- **Environment:** the rendered UI spec + its live DOM text, the human speaker, the generator backend (another stochastic model), the network.
- **Actuators:** `read_ui` (perceive), `refine_ui` (edit), `generate_ui` (replace), and the TTS audio channel (speech is itself an actuator on the human).
- **Sensors:** mic audio (continuous), input/output transcripts, the cached `readable` UI text, the current spec.

**Standard environment classification (typical verdicts):**
- Partially observable (DOM text only; sandboxed iframes opaque).
- Multi-agent, mostly cooperative (the human) + a second stochastic model (the generator) as part of the environment.
- Stochastic (LLM generation + ASR are non-deterministic).
- Sequential (the UI is a persistent state edited turn over turn).
- Dynamic (the human and the UI can change while the agent "thinks"; barge-in/interruption matters).
- Continuous (audio signal, real-time).
- Partially known (tool semantics known; generator's exact output unknown).

**Recommended architecture:** model-based, utility-leaning agent. The critical design requirement is an *observe-act-observe* loop: refresh the world model (re-read UI) AFTER acting, not just at session start, and surface a confidence/verification step so the agent doesn't claim success on a silent no-op.
