import assert from 'node:assert/strict';
import test from 'node:test';
import { explain, routeToolbox, type Answers } from './policy.ts';
import { ASK, T } from './router.questions.ts';

/** A clear, specific, safe prompt: dense ops console on the registry. */
function base(over: Partial<Record<keyof Answers, unknown>> = {}): Answers {
  const a = {
    design: { choice: 'ops_console', probabilities: { editorial_serif: 0.05, ops_console: 0.9, soft_consumer: 0.03, unclear: 0.02 }, confidence: 0.9 },
    render: { choice: 'registry', probabilities: { registry: 0.85, sandboxed_react: 0.1, unclear: 0.05 }, confidence: 0.85 },
    specificity: { score: 1.9 },
    need_stepper: { noul: 0.05 }, need_table: { noul: 0.9 }, need_drawer: { noul: 0.7 }, need_citations: { noul: 0.1 },
    need_approval: { noul: 0.1 }, async_data: { noul: 0.2 },
    miss_audience: { noul: 0.1 }, miss_data: { noul: 0.1 }, miss_action: { noul: 0.1 },
    injection: { noul: 0.01 }, contradictory: { noul: 0.02 },
  };
  return { ...a, ...over } as Answers;
}

test('routes a specific prompt and always keeps the base checks', () => {
  const d = routeToolbox(base());
  assert.equal(d.kind, 'route');
  if (d.kind !== 'route') return;
  assert.equal(d.designSystem, 'ops_console');
  assert.equal(d.renderMode, 'registry');
  assert.deepEqual(d.components, ['table', 'drawer']);
  assert.deepEqual(d.checks, ['axe_core', 'impeccable_loop', 'empty_loading_error_states']);
  assert.equal(d.evidence['design.p'], 0.9);
});

test('a thrown backend error or missing answers fail closed to hold jev_error', () => {
  assert.deepEqual(routeToolbox(null, new Error('403')), { kind: 'hold', reason: 'jev_error', evidence: {} });
  assert.equal(routeToolbox(undefined).kind, 'hold');
  const broken = base({ injection: { noul: 'high' } });
  const d = routeToolbox(broken);
  assert.equal(d.kind === 'hold' && d.reason, 'jev_error');
});

test('injection holds even when everything else would route', () => {
  const d = routeToolbox(base({ injection: { noul: T.INJECT } }));
  assert.equal(d.kind === 'hold' && d.reason, 'unsafe_or_injection');
});

test('injection outranks an otherwise-missing slot', () => {
  const d = routeToolbox(base({ injection: { noul: 0.9 }, specificity: { score: 0.2 }, miss_audience: { noul: 0.95 } }));
  assert.equal(d.kind === 'hold' && d.reason, 'unsafe_or_injection');
});

test('contradictory prompts hold at the 0.7 line, not below', () => {
  assert.equal(routeToolbox(base({ contradictory: { noul: 0.69 } })).kind, 'route');
  const d = routeToolbox(base({ contradictory: { noul: 0.7 } }));
  assert.equal(d.kind === 'hold' && d.reason, 'contradictory');
});

test('vague prompts ask for the most-missing slot with the fixed copy', () => {
  const d = routeToolbox(base({ specificity: { score: 0.4 }, miss_audience: { noul: 0.7 }, miss_data: { noul: 0.92 }, miss_action: { noul: 0.8 } }));
  assert.deepEqual(d.kind === 'ask' && [d.slot, d.prompt], ['data_source', ASK.data_source]);
});

test('vague but nothing clearly missing falls through to the design gate', () => {
  const d = routeToolbox(base({ specificity: { score: 0.4 }, miss_audience: { noul: 0.3 }, miss_data: { noul: 0.3 }, miss_action: { noul: 0.3 } }));
  assert.equal(d.kind, 'route');
});

test('design unclear, or picked below PICK, asks for the audience', () => {
  const unclear = routeToolbox(base({ design: { choice: 'unclear', probabilities: { unclear: 0.9 } } }));
  assert.equal(unclear.kind === 'ask' && unclear.slot, 'audience');
  // high reported confidence does not rescue a low picked probability
  const low = routeToolbox(base({ design: { choice: 'ops_console', probabilities: { ops_console: 0.55 }, confidence: 0.99 } }));
  assert.equal(low.kind === 'ask' && low.slot, 'audience');
});

test('render unclear or low holds with low_confidence', () => {
  const d = routeToolbox(base({ render: { choice: 'sandboxed_react', probabilities: { sandboxed_react: 0.6 } } }));
  assert.equal(d.kind === 'hold' && d.reason, 'low_confidence');
  const u = routeToolbox(base({ render: { choice: 'unclear', probabilities: { unclear: 0.95 } } }));
  assert.equal(u.kind === 'hold' && u.reason, 'low_confidence');
});

test('approval card joins in the maybe band; other components need COMP_YES', () => {
  const d = routeToolbox(base({ need_approval: { noul: 0.4 }, need_stepper: { noul: 0.59 } }));
  assert.ok(d.kind === 'route');
  if (d.kind !== 'route') return;
  assert.ok(d.components.includes('approval_card'));
  assert.ok(!d.components.includes('stepper'));
  assert.ok(explain(d).some((l) => /maybe band/.test(l)));
});

test('citations in the maybe band add the couldnt-verify check', () => {
  const d = routeToolbox(base({ need_citations: { noul: 0.4 } }));
  assert.ok(d.kind === 'route' && d.checks.includes('couldnt_verify_state'));
  assert.ok(d.kind === 'route' && !d.components.includes('citation_viewer'));
});

test('explain writes one plain line per hold reason', () => {
  const lines = explain({ kind: 'hold', reason: 'jev_error', evidence: {} });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /fail closed/);
});

test('explain names the real reason for an ask', () => {
  const vague = routeToolbox(base({ specificity: { score: 0.4 }, miss_data: { noul: 0.92 } }));
  assert.match(explain(vague)[1], /Specificity 0\.40/);
  const style = routeToolbox(base({ design: { choice: 'soft_consumer', probabilities: { soft_consumer: 0.6 } } }));
  assert.match(explain(style)[1], /visual style is not clear enough: the best design-system pick is 60%/);
});
