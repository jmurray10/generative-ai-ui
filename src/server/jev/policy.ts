/**
 * routeToolbox: the code-owned policy that turns typed judgments into a Decision.
 *
 * Judgments come from Jev (or the Grok fallback, which answers the same
 * questions in the same shape). The judgments can push a prompt to ask or
 * hold. They can never remove an always-on check or skip the sandbox.
 */
import type { Check, Decision, DesignSystem, MissingSlot, RenderMode, ToolboxComponent } from '../../shared/toolbox.ts';
import { ASK, T, type QuestionId } from './router.questions.ts';

export interface ChoiceAnswer { type?: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
export interface ScoreAnswer { type?: 'score'; score: number; probabilities?: Record<string, number>; confidence?: number }
export interface NoulAnswer { type?: 'noul'; noul: number }

export type Answers = {
  design: ChoiceAnswer;
  render: ChoiceAnswer;
  specificity: ScoreAnswer;
} & { [K in Exclude<QuestionId, 'design' | 'render' | 'specificity'>]: NoulAnswer };

const ALWAYS_ON: Check[] = ['axe_core', 'impeccable_loop', 'empty_loading_error_states'];
const DESIGN: ReadonlySet<string> = new Set(['editorial_serif', 'ops_console', 'soft_consumer']);
const RENDER: ReadonlySet<string> = new Set(['registry', 'sandboxed_react']);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Probability of the picked option. Gate on this, not only on `.confidence`. */
export function pickedProbability(a: ChoiceAnswer): number {
  return num(a?.probabilities?.[a.choice]);
}

/** Throws when a required answer is missing or not a number, so the caller holds. */
function assertWellFormed(a: Answers): void {
  const bad: string[] = [];
  for (const k of ['design', 'render'] as const) {
    if (typeof a[k]?.choice !== 'string' || Number.isNaN(pickedProbability(a[k]))) bad.push(k);
  }
  if (Number.isNaN(num(a.specificity?.score))) bad.push('specificity');
  const nouls = ['need_stepper', 'need_table', 'need_drawer', 'need_citations', 'need_approval', 'async_data',
    'miss_audience', 'miss_data', 'miss_action', 'injection', 'contradictory'] as const;
  for (const k of nouls) if (Number.isNaN(num(a[k]?.noul))) bad.push(k);
  if (bad.length) throw new Error(`malformed answers: ${bad.join(', ')}`);
}

export function evidenceOf(a: Answers): Record<string, number> {
  const e: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (!v) continue;
    if ('noul' in v) e[k] = r3(num(v.noul));
    else if ('choice' in v) {
      e[`${k}.p`] = r3(pickedProbability(v));
      if (typeof v.confidence === 'number') e[`${k}.confidence`] = r3(v.confidence);
    } else if ('score' in v) e[k] = r3(num(v.score));
  }
  return e;
}

export function routeToolbox(answers: Answers | null | undefined, error?: unknown): Decision {
  if (error || !answers) return { kind: 'hold', reason: 'jev_error', evidence: {} };
  try {
    assertWellFormed(answers);
  } catch {
    return { kind: 'hold', reason: 'jev_error', evidence: {} };
  }
  const evidence = evidenceOf(answers);

  if (answers.injection.noul >= T.INJECT) return { kind: 'hold', reason: 'unsafe_or_injection', evidence };
  if (answers.contradictory.noul >= T.CONTRADICT) return { kind: 'hold', reason: 'contradictory', evidence };

  if (answers.specificity.score < T.MARGIN) {
    const missing: [MissingSlot, number][] = [
      ['audience', answers.miss_audience.noul],
      ['data_source', answers.miss_data.noul],
      ['primary_action', answers.miss_action.noul],
    ];
    const [slot, p] = missing.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    if (p >= T.MISSING) return { kind: 'ask', slot, prompt: ASK[slot], evidence };
  }

  const design = answers.design;
  if (!DESIGN.has(design.choice) || pickedProbability(design) < T.PICK) {
    return { kind: 'ask', slot: 'audience', prompt: ASK.audience, evidence };
  }
  const render = answers.render;
  if (!RENDER.has(render.choice) || pickedProbability(render) < T.PICK) {
    return { kind: 'hold', reason: 'low_confidence', evidence };
  }

  const components: ToolboxComponent[] = [];
  const want: [ToolboxComponent, number][] = [
    ['stepper', answers.need_stepper.noul],
    ['table', answers.need_table.noul],
    ['drawer', answers.need_drawer.noul],
    ['citation_viewer', answers.need_citations.noul],
  ];
  for (const [c, p] of want) if (p >= T.COMP_YES) components.push(c);
  // Code owns the approval card: it shows even in the maybe band.
  if (answers.need_approval.noul >= T.COMP_MAYBE) components.push('approval_card');

  const checks: Check[] = [...ALWAYS_ON];
  if (answers.need_citations.noul >= T.COMP_MAYBE) checks.push('couldnt_verify_state');

  return {
    kind: 'route',
    designSystem: design.choice as DesignSystem,
    renderMode: render.choice as RenderMode,
    components,
    checks,
    evidence,
  };
}

const pct = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : 'n/a');

/** Plain-language log lines for the "why these tools" panel. Written by code, read by voice. */
export function explain(d: Decision): string[] {
  const e = d.evidence;
  if (d.kind === 'hold') {
    const why: Record<string, string> = {
      jev_error: 'Held: the decision layer did not return usable judgments, so nothing was built (fail closed).',
      unsafe_or_injection: `Held: the prompt looks like it tries to override instructions or reach secrets (injection ${pct(e.injection)}, threshold ${pct(T.INJECT)}).`,
      contradictory: `Held: the prompt has requirements that contradict each other (${pct(e.contradictory)}, threshold ${pct(T.CONTRADICT)}).`,
      low_confidence: `Held: not confident whether the registry can build this (render pick ${pct(e['render.p'])}, needs ${pct(T.PICK)}).`,
    };
    return [why[d.reason]];
  }
  if (d.kind === 'ask') {
    const spec = typeof e.specificity === 'number' ? e.specificity : NaN;
    const because = spec < T.MARGIN
      ? `Specificity ${spec.toFixed(2)} of 2 is below ${T.MARGIN}, and the ${d.slot.replace('_', ' ')} looks missing (audience ${pct(e.miss_audience)}, data ${pct(e.miss_data)}, action ${pct(e.miss_action)}).`
      : `The visual style is not clear enough: the best design-system pick is ${pct(e['design.p'])}, and it needs ${pct(T.PICK)}.`;
    return [`Asking before building: "${d.prompt}"`, because];
  }
  const lines = [
    `Design system: ${d.designSystem.replace('_', ' ')} (picked at ${pct(e['design.p'])}, needs ${pct(T.PICK)}).`,
    `Render path: ${d.renderMode === 'registry' ? 'registry components' : 'sandboxed React'} (picked at ${pct(e['render.p'])}).`,
    d.components.length ? `Components: ${d.components.join(', ').replace(/_/g, ' ')}.` : 'Components: none beyond the base registry.',
    `Checks: ${d.checks.join(', ').replace(/_/g, ' ')}.`,
  ];
  if (d.components.includes('approval_card') && (e.need_approval ?? 0) < T.COMP_YES) {
    lines.push(`Approval card added by policy in the maybe band (${pct(e.need_approval)}).`);
  }
  return lines;
}
