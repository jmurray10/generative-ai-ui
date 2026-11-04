/**
 * Example PROMPTS only — there are NO canned/hard-coded specs.
 *
 * Clicking one asks the model to generate the UI live, pulling from its toolbox:
 *   - the whitelisted registry components (reliable, stateful widgets),
 *   - the sandboxed `CustomWidget` (vanilla canvas/JS),
 *   - the freeform `ReactArtifact` lane (real React + Tailwind + npm imports).
 *
 * Each one is chosen to stress a different part of the system AND to be worth
 * talking to once it's built — `tryIt` lists things to say or type to the live
 * UI, which chat and voice carry out by operating it (no regeneration).
 */
import type { Example } from '../shared/spec.ts';

export const examples: Example[] = [
  {
    id: 'trading',
    title: 'Trading terminal',
    prompt:
      'a crypto trading terminal: a live-ticking candlestick price chart, an order book with bid/ask depth bars, a market/limit order ticket and a positions table — dense, dark instrument-panel design',
    blurb: 'Dense data, live ticking, recharts in the freeform lane.',
    lane: 'react',
    tryIt: ['Switch to ETH', 'Buy 0.5 at market', 'What is the spread right now?'],
  },
  {
    id: 'solar',
    title: '3D solar system',
    prompt:
      'an interactive 3D solar system with three.js: a full-screen WebGL scene of the sun and orbiting planets at relative speeds as the hero, with a small overlaid panel for time speed; click a planet to fly the camera to it and show a fact card',
    blurb: 'Real 3D in a sandbox, driven by the conversation.',
    lane: 'react',
    tryIt: ['Fly to Saturn', 'Speed time up 10x', 'Which planet are we looking at?'],
  },
  {
    id: 'drums',
    title: 'Drum machine',
    prompt:
      'a 16-step drum machine using the Web Audio API: kick, snare, hat and clap rows, a playhead, tempo and swing controls, and a few preset patterns — styled like a piece of hardware',
    blurb: 'Synthesized sound, a sequencer grid and hardware-grade design.',
    lane: 'react',
    tryIt: ['Play a four-on-the-floor beat', 'Set the tempo to 128', 'Add claps on 2 and 4'],
  },
  {
    id: 'mortgage',
    title: 'Home affordability',
    prompt:
      'a home affordability planner: income, monthly debts, down payment, interest rate and loan term inputs, showing the monthly payment, maximum home price, debt-to-income ratio and a cost breakdown',
    blurb: 'Registry lane: reactive state you can steer by voice.',
    lane: 'registry',
    tryIt: ['Set the rate to 6.25%', 'What if my down payment is $90,000?', 'Read me the monthly payment'],
  },
  {
    id: 'incidents',
    title: 'Incident console',
    prompt:
      'an on-call incident console: a live queue of alerts with severity, service and age, filters, a detail drawer with a timeline, and acknowledge / escalate / resolve actions',
    blurb: 'Jev picks the table + drawer; the agent works the queue.',
    lane: 'react',
    tryIt: ['Show only critical alerts', 'Acknowledge the oldest one', 'Escalate the payments incident'],
  },
  {
    id: 'snake',
    title: 'Snake',
    prompt: 'a fully playable snake game with arrow-key controls, a score and a high score',
    blurb: 'The model writes a real game in a sandbox.',
    lane: 'sandbox',
    tryIt: ['Pause the game', 'Make it faster', 'What is my score?'],
  },
];
