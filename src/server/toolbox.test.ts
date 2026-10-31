import assert from 'node:assert/strict';
import test from 'node:test';
import { decideToolbox } from './toolbox.ts';
import { deciderChoice } from './config.ts';
import { askJev, JevError } from './jev/client.ts';
import { toChoice } from './jev/grok-judge.ts';
import { Q } from './jev/router.questions.ts';

const yes = (p: number) => ({ type: 'noul', noul: p });
const mockAnswers = {
  design: { type: 'choice', choice: 'soft_consumer', probabilities: { editorial_serif: 0.04, ops_console: 0.06, soft_consumer: 0.86, unclear: 0.04 }, confidence: 0.8 },
  render: { type: 'choice', choice: 'registry', probabilities: { registry: 0.8, sandboxed_react: 0.15, unclear: 0.05 }, confidence: 0.8 },
  specificity: { type: 'score', score: 1.8, probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 } },
  need_stepper: yes(0.93), need_table: yes(0.1), need_drawer: yes(0.1), need_citations: yes(0.2), need_approval: yes(0.81), async_data: yes(0.1),
  miss_audience: yes(0.1), miss_data: yes(0.1), miss_action: yes(0.1), injection: yes(0.01), contradictory: yes(0.02),
};

test('deciderChoice: auto prefers Jev, then Grok; explicit jev without a key is none', () => {
  assert.equal(deciderChoice({ TYPESAFE_API_KEY: 'k', XAI_API_KEY: 'x' }), 'jev');
  assert.equal(deciderChoice({ XAI_API_KEY: 'x' }), 'grok');
  assert.equal(deciderChoice({}), 'none');
  assert.equal(deciderChoice({ TOOLBOX_DECIDER: 'jev', XAI_API_KEY: 'x' }), 'none');
  assert.equal(deciderChoice({ TOOLBOX_DECIDER: 'grok', TYPESAFE_API_KEY: 'k', XAI_API_KEY: 'x' }), 'grok');
});

test('decideToolbox routes on mocked Jev answers and logs why', async () => {
  const env = await decideToolbox('an intake wizard', { source: 'jev', judge: async () => ({ answers: mockAnswers as any, model: 'jev-1.13.0' }) });
  assert.equal(env.decision.kind, 'route');
  if (env.decision.kind !== 'route') return;
  assert.deepEqual(env.decision.components, ['stepper', 'approval_card']);
  assert.equal(env.source, 'jev');
  assert.ok(env.why.some((l) => l.startsWith('Design system: soft consumer')));
});

test('a backend error holds with jev_error and never leaks the request', async () => {
  const env = await decideToolbox('anything', { source: 'jev', judge: async () => { throw new JevError('TypeSafe 403 authentication_error', 403); } });
  assert.deepEqual(env.decision, { kind: 'hold', reason: 'jev_error', evidence: {} });
  assert.match(env.error ?? '', /403/);
});

test('no backend configured holds', async () => {
  const env = await decideToolbox('x', { source: 'none', judge: null });
  assert.equal(env.decision.kind, 'hold');
});

test('askJev sends the SDK wire shape with a Bearer key and maps auth errors', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ detail: { error_type: 'authentication_error', message: 'no' } }), { status: 403 });
  }) as unknown as typeof fetch;
  await assert.rejects(askJev('p', { TYPESAFE_API_KEY: 'secret-key' }, fake), (e: JevError) => e.status === 403 && !e.message.includes('secret-key'));
  assert.ok(seen);
  const s = seen as unknown as { url: string; init: RequestInit };
  assert.equal(s.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal((s.init.headers as Record<string, string>).Authorization, 'Bearer secret-key');
  const body = JSON.parse(String(s.init.body));
  assert.equal(body.model, 'jev-1.13.0');
  assert.equal(body.questions.design.type, 'choice');
  assert.deepEqual(Object.keys(body.questions).sort(), Object.keys(Q).sort());
  assert.equal(body.state.prompt, 'p');
});

test('askJev returns answers on 200', async () => {
  const fake = (async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: mockAnswers }), { status: 200 })) as unknown as typeof fetch;
  const r = await askJev('p', { TYPESAFE_API_KEY: 'k' }, fake);
  assert.equal(r.answers.design.choice, 'soft_consumer');
});

test('toChoice normalizes Grok probabilities and picks the argmax', () => {
  const c = toChoice({ registry: 2, sandboxed_react: 1, unclear: 1 });
  assert.equal(c.choice, 'registry');
  assert.equal(c.probabilities.registry, 0.5);
});
