---
name: generative-theming
description: Generative theming feature in genui-playground — model emits optional theme hexes applied as scoped --gp-* CSS vars; known contrast/shading gaps
metadata:
  type: project
---

The Gemini model may emit an optional `theme` ({bg, surface, text, muted, accent, border?, font?}) in the UI spec. Applied via scoped `--gp-*` CSS variables on the generated `<section>` in `GeneratedApp.tsx`; Tailwind tokens (canvas/panel/edge/ink/muted/accent) read those vars. Sandboxed lanes (CustomWidget/ReactArtifact) are isolated iframes and theme themselves.

**Why:** public demo whose whole point is the UI visually transforming to match the prompt topic. Color variety is actively maximized by the prompt ("pick a DISTINCT palette, do not default to the same colors").

**Status as of 2026-06-19 review (much of the 2026-06 list is now FIXED):**
- FIXED — contrast enforcement now exists in `themeStyle` (GeneratedApp.tsx): `ensureOn` flips body text to black/white if it fails 4.5:1 vs surface; `deriveMuted` mixes text→surface staying >=4.5:1; `onAccent` luminance-flip drives `--gp-on-accent`, and registry Button is now `text-accent-ink` (reads that var). Proper linearized relLum() used. Good.
- FIXED — accent shades now use `mix(accent,WHITE/BLACK,0.28)` (asymptotic), not flat additive `shadeCh`.
- FIXED — focus ring is now `rgb(var(--gp-accent-soft))` in index.css, so it picks up the themed accent.
**Still OPEN (verify before recommending):**
- **Surface-alpha gap.** `ensureOn`/`deriveMuted` target the OPAQUE surface hex, but components render translucent: Card `bg-panel/80`, Stat/inputs `bg-canvas/60` (page bg, not surface!). Real contrast is lower than the 4.5:1 the math guarantees, and Stat/NumberInput/TextInput/Select are checked against the wrong background entirely. Fix: compute against the effective composited color (or render themed surfaces opaque).
- **Themed frame inconsistency + purple halo (NOT fixed).** Frame `bg-canvas p-5 rounded-2xl` only applies when themed; the page keeps its hardcoded purple radial gradient + `--gp-accent-soft` focus ring is themed but the body bg is not. Themed cards still float on a conflicting purple wash. Neutralize/retint page bg when a theme is active.
- **Focus-ring contrast not guaranteed.** Tokenized to accent-soft but accent-soft is not contrast-checked vs the themed bg — can drop below 3:1 (WCAG 2.4.11/1.4.11). Derive a `--gp-focus` clamped to >=3:1 vs bg.
- **Toggle knob still hardcoded `bg-white`** (components.tsx ~L371) — invisible on a white/light themed surface. Should follow the theme.
- **Font `<link>` always requests `wght@400;500;700`** — wrong for single-weight display fonts; minor, acceptable for demo; links never cleaned up (minor leak).

See [[design-system]] for the token set these vars drive.
