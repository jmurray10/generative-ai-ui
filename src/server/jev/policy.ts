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

export type Thresholds = { readonly [K in keyof typeof T]: number };

export interface RouteContext {
  /** True once the person has answered one ask. The policy then routes or holds; it never asks again. */
  answered?: boolean;
}

const CONCRETE: DesignSystem[] = ['editorial_serif', 'ops_console', 'soft_consumer'];
/** Components the registry lane cannot draw. Needing one sends the UI to the sandboxed React lane. */
const NEEDS_SANDBOX: ReadonlySet<ToolboxComponent> = new Set(['stepper', 'table', 'drawer', 'citation_viewer']);

/** Best concrete design system and its probability (ignores "unclear"). */
export function bestDesign(a: ChoiceAnswer): [DesignSystem, number] {
  return CONCRETE.map((d) => [d, num(a.probabilities?.[d])] as [DesignSystem, number])
    .filter(([, p]) => !Number.isNaN(p))
    .reduce((best, cur) => (cur[1] > best[1] ? cur : best), ['ops_console', -1] as [DesignSystem, number]);
}

export function routeToolbox(answers: Answers | null | undefined, error?: unknown, ctx: RouteContext = {}, t: Thresholds = T): Decision {
  if (error || !answers) return { kind: 'hold', reason: 'jev_error', evidence: {} };
  try {
    assertWellFormed(answers);
  } catch {
    return { kind: 'hold', reason: 'jev_error', evidence: {} };
  }
  const evidence = evidenceOf(answers);
  const unclearP = num(answers.design.probabilities?.unclear);
  if (!Number.isNaN(unclearP)) evidence['design.unclear'] = r3(unclearP);
  if (ctx.answered) evidence.answered = 1;

  // Safety first, on every pass, answered or not.
  if (answers.injection.noul >= t.INJECT) return { kind: 'hold', reason: 'unsafe_or_injection', evidence };
  if (answers.contradictory.noul >= t.CONTRADICT) return { kind: 'hold', reason: 'contradictory', evidence };

  const [design, designP] = bestDesign(answers.design);
  evidence['design.best'] = r3(designP);
  const designUnclear = designP < t.PICK || (!Number.isNaN(unclearP) && unclearP >= t.DESIGN_UNCLEAR);

  if (!ctx.answered) {
    if (answers.specificity.score < t.MARGIN) {
      const missing: [MissingSlot, number][] = [
        ['audience', answers.miss_audience.noul],
        ['data_source', answers.miss_data.noul],
        ['primary_action', answers.miss_action.noul],
      ];
      const [slot, p] = missing.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
      if (p >= t.MISSING) return { kind: 'ask', slot, prompt: ASK[slot], evidence };
    }
    if (designUnclear) return { kind: 'ask', slot: 'audience', prompt: ASK.audience, evidence };
  } else if (designP < t.PICK_AFTER) {
    // One answer is all we ask for. If the style is still a guess, hold instead of looping.
    return { kind: 'hold', reason: 'low_confidence', evidence };
  }

  const components: ToolboxComponent[] = [];
  const want: [ToolboxComponent, number][] = [
    ['stepper', answers.need_stepper.noul],
    ['table', answers.need_table.noul],
    ['drawer', answers.need_drawer.noul],
    ['citation_viewer', answers.need_citations.noul],
  ];
  for (const [c, p] of want) if (p >= t.COMP_YES) components.push(c);
  // Code owns the approval card: it shows even in the maybe band.
  if (answers.need_approval.noul >= t.COMP_MAYBE) components.push('approval_card');

  // Render path. Code rule first: a component the registry cannot draw means the sandbox.
  // Otherwise use the registry only when Jev is confident it fits; when unsure, the sandboxed
  // React lane is the safe default because it can draw anything and is still isolated.
  const registryP = num(answers.render.probabilities?.registry);
  const renderMode: RenderMode = components.some((c) => NEEDS_SANDBOX.has(c)) || !(registryP >= t.RENDER_PICK) ? 'sandboxed_react' : 'registry';
  evidence['render.registry'] = r3(registryP);

  const checks: Check[] = [...ALWAYS_ON];
  if (answers.need_citations.noul >= t.COMP_MAYBE) checks.push('couldnt_verify_state');

  return { kind: 'route', designSystem: design, renderMode, components, checks, evidence };
}

const COMPONENT_LABEL: Record<ToolboxComponent, string> = {
  stepper: 'stepper', table: 'data table', drawer: 'side drawer', citation_viewer: 'citation viewer', approval_card: 'approval card',
};
const CHECK_LABEL: Record<Check, string> = {
  axe_core: 'accessibility scan (axe-core)',
  impeccable_loop: 'Impeccable design scan',
  empty_loading_error_states: 'empty/loading/error states',
  couldnt_verify_state: "a \"couldn't verify\" state",
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

const pct = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : 'n/a');

/** Plain-language log lines for the "why these tools" panel. Written by code, read by voice. */
export function explain(d: Decision): string[] {
  const e = d.evidence;
  if (d.kind === 'hold') {
    const why: Record<string, string> = {
      jev_error: 'Held: the decision layer did not return usable judgments, so nothing was built (fail closed).',
      unsafe_or_injection: `Held: the prompt looks like it tries to override instructions or reach secrets (injection ${pct(e.injection)}, threshold ${pct(T.INJECT)}).`,
      contradictory: `Held: the prompt has requirements that contradict each other (${pct(e.contradictory)}, threshold ${pct(T.CONTRADICT)}).`,
      low_confidence: e.answered && (e['design.best'] ?? 0) < T.PICK_AFTER
        ? `Held: even after your answer the visual style is a guess (best pick ${pct(e['design.best'])}, needs ${pct(T.PICK_AFTER)}). Asking again would loop, so nothing was built.`
        : 'Held: not confident enough to build.',
    };
    return [why[d.reason]];
  }
  if (d.kind === 'ask') {
    const spec = typeof e.specificity === 'number' ? e.specificity : NaN;
    const because = spec < T.MARGIN
      ? `Specificity ${spec.toFixed(2)} of 2 is below ${T.MARGIN}, and the ${d.slot.replace('_', ' ')} looks missing (audience ${pct(e.miss_audience)}, data ${pct(e.miss_data)}, action ${pct(e.miss_action)}).`
      : `The visual style is not clear enough: the best design-system pick is ${pct(e['design.best'])} (needs ${pct(T.PICK)}) and "unclear" is ${pct(e['design.unclear'])} (limit ${pct(T.DESIGN_UNCLEAR)}).`;
    return [`Asking before building: "${d.prompt}"`, because];
  }
  const lines = [
    ...(e.answered ? ['Built from your one answer; the policy never asks twice.'] : []),
    `Design system: ${d.designSystem.replace('_', ' ')} (picked at ${pct(e['design.best'])}, needs ${pct(T.PICK)}).`,
    d.renderMode === 'sandboxed_react' && d.components.some((c) => NEEDS_SANDBOX.has(c))
      ? (() => { const need = d.components.filter((c) => NEEDS_SANDBOX.has(c)).map((c) => COMPONENT_LABEL[c]); return `Render path: sandboxed React, because the registry has no ${list(need)}.`; })()
      : d.renderMode === 'registry'
        ? `Render path: registry components (fit at ${pct(e['render.registry'])}, needs ${pct(T.RENDER_PICK)}).`
        : `Render path: sandboxed React (registry fit only ${pct(e['render.registry'])}; the sandbox can draw anything).`,
    d.components.length ? `Components: ${list(d.components.map((c) => COMPONENT_LABEL[c]))}.` : 'Components: none beyond the base registry.',
    `Checks: ${list(d.checks.map((c) => CHECK_LABEL[c]))}.`,
  ];
  if (d.components.includes('approval_card') && (e.need_approval ?? 0) < T.COMP_YES) {
    lines.push(`Approval card added by policy in the maybe band (${pct(e.need_approval)}).`);
  }
  return lines;
}
