import assert from 'node:assert/strict';
import test from 'node:test';
import { getGenerator, isDegradedSpec } from './generator.ts';
import { namespaceScreen } from './spec-build.ts';

test('without a key, the default grok choice falls back to the stub notice', async () => {
  const env = { GENERATOR: 'grok' } as NodeJS.ProcessEnv;
  const generator = getGenerator(env);
  assert.equal(generator.name, 'stub');
  const spec = await generator.generate('a counter');
  assert.equal(isDegradedSpec(spec), true);
  assert.match(String(spec.tree[0].children?.[0].props?.value), /XAI_API_KEY/);
});

test('an explicit stub stays offline even if a key is present', () => {
  const generator = getGenerator({ GENERATOR: 'stub', XAI_API_KEY: 'test-key' });
  assert.equal(generator.name, 'stub');
  assert.equal(generator.model, null);
});

test('a grok key selects the grok generator and does not call the network', () => {
  const generator = getGenerator({ GENERATOR: 'grok', XAI_API_KEY: 'test-key', GROK_MODEL: 'grok-4.7' });
  assert.equal(generator.name, 'grok');
  assert.equal(generator.model, 'grok-4.7');
});

test('namespaceScreen prefixes state keys but leaves expr-eval built-ins alone', () => {
  const { tree, initialState } = namespaceScreen({
    initialState: { bill: 10, max: 3 },
    tree: [{
      id: 'total',
      type: 'Stat',
      props: { stateKey: 'bill' },
      bind: { value: 'max(bill, 1)' },
    }],
  }, 's0_');
  assert.equal(initialState.s0_bill, 10);
  assert.equal(initialState.max, 3);
  assert.equal(tree[0].id, 's0_total');
  assert.equal((tree[0].props as { stateKey: string }).stateKey, 's0_bill');
  assert.equal(tree[0].bind?.value, 'max(s0_bill, 1)');
});
