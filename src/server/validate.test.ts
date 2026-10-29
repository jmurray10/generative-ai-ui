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

test('validateSpec keeps unknown component types', () => {
  const { spec, warnings } = validateSpec({ tree: [{ id: 'z', type: 'NotAThing' }] });
  assert.equal(spec.tree[0].type, 'NotAThing');
  assert.match(warnings[0], /Unknown component/);
});
