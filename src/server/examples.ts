/**
 * Example PROMPTS only — there are NO canned/hard-coded specs.
 *
 * Clicking one asks the model to generate the UI live, pulling from its toolbox:
 *   - the whitelisted registry components (reliable, stateful widgets),
 *   - the sandboxed `CustomWidget` (vanilla canvas/JS),
 *   - the freeform `ReactArtifact` lane (real React + Tailwind + npm imports).
 *
 * The whole point is to show the model doing the generating in a hybrid setup,
 * so nothing here describes a fixed output — only an intent.
 */
import type { Example } from '../shared/spec.ts';

export const examples: Example[] = [
  { id: 'tip', title: 'Tip calculator', prompt: 'a tip calculator that splits the bill between people', blurb: 'Tends to use registry components + reactive state.' },
  { id: 'dashboard', title: 'Sales dashboard', prompt: 'a quarterly sales dashboard with KPI cards and a bar chart', blurb: 'Registry layout, stats and charts.' },
  { id: 'snake', title: 'Snake game', prompt: 'a fully playable snake game with arrow-key controls and a score', blurb: 'The model writes a real game in a sandbox.' },
  { id: 'weather', title: 'Weather card', prompt: 'a beautiful glassmorphism weather card with a gradient sky and a forecast row', blurb: 'Freeform React + Tailwind.' },
  { id: 'kanban', title: 'Kanban board', prompt: 'a kanban board with three columns and draggable cards using framer-motion', blurb: 'Freeform lane pulling in an npm package.' },
  { id: 'pomodoro', title: 'Pomodoro timer', prompt: 'a pomodoro focus timer with start, pause and reset and a circular progress ring', blurb: 'The model picks the right tool for the job.' },
];
