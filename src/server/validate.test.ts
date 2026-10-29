import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSpec } from './validate.ts';

test('validateSpec repairs a missing id and drops a node without a type', () => {
  const { spec, warnings } = validateSpec({
    title: 'Demo',
    tree: [{ type: 'Card', props: { title: 'Hello' } }, { props: { title: 'nope' } }],
  });
  assert.equal(spec.title, 'Demo');
  assert.equal(spec.tree.length, 1);
  assert.equal(spec.tree[0].type, 'Card');
  assert.match(spec.tree[0].id, /^card-/);
  assert.equal(warnings.length, 1);
});

test('validateSpec rejects a payload with no tree', () => {
  assert.throws(() => validateSpec({ title: 'x' }), /tree/);
});

test('validateSpec fills missing initialState and warns', () => {
  const { spec, warnings } = validateSpec({
    title: 'Quote',
    tree: [
      { id: 'rate', type: 'Slider', props: { label: 'Rate', stateKey: 'rate', min: 1, max: 20 } },
      { id: 'on', type: 'Toggle', props: { stateKey: 'enabled' } },
      { id: 'out', type: 'Stat', props: { label: 'Total' }, bind: { value: 'rate * 2' } },
    ],
  });
  assert.equal(spec.initialState?.rate, 1);
  assert.equal(spec.initialState?.enabled, false);
  assert.equal(spec.initialState?.['2'], undefined);
  assert.ok(warnings.some((warning) => /rate/.test(warning) && /enabled/.test(warning)));
});

test('validateSpec keeps unknown component types', () => {
  const { spec, warnings } = validateSpec({ tree: [{ id: 'z', type: 'NotAThing' }] });
  assert.equal(spec.tree[0].type, 'NotAThing');
  assert.match(warnings[0], /Unknown component/);
});
