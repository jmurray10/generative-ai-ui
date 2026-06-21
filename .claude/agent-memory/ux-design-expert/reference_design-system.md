---
name: reference-design-system
description: Design tokens, theme, and UI conventions used across genui-playground
metadata:
  type: reference
---

Dark-only theme. Tokens in `tailwind.config.js`:
- canvas `#0b0b12`, panel `#15151f`, edge `#262635`
- ink `#e7e7f0` (text), muted `#b8b8cf` (secondary text)
- accent `#7c5cff` / soft `#9d86ff` / deep `#5b3fd6`
- font: Inter (loaded from Google Fonts in `index.css`)

Conventions: rounded-xl/2xl panels, `bg-panel/60` translucent surfaces, radial purple background gradients (fixed). Global `:focus-visible` ring is defined (2px `#9d86ff`). `prefers-reduced-motion` disables animate-rise/ping/pulse.

Known gaps (as of 2026-06 review): muted text on translucent panels often falls below WCAG AA 4.5:1; example chips and "View spec"/"Voice" are plain `<button>`/`<div>` toggles without `aria-pressed`/`aria-expanded`; the streamed build region is `aria-live="polite"` on `<main>` but the per-node log is not separately announced; voice transcript list is not a live region and lacks roles.

**How to apply:** Reuse these tokens rather than inventing colors. When proposing contrast fixes, push muted text toward ink or solidify panel backgrounds.
