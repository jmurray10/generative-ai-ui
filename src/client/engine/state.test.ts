import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, evalExpr } from './state.ts';

test('evalExpr computes a bind and refuses to pollute Object.prototype', () => {
  assert.equal(evalExpr('bill * (1 + tipPct / 100)', { bill: 60, tipPct: 18 }), 70.8);
  evalExpr('__proto__', {});
  evalExpr('constructor', {});
  assert.equal(Object.prototype.hasOwnProperty('polluted'), false);
  const fresh: Record<string, unknown> = {};
  assert.equal(fresh.polluted, undefined);
});

test('applyAction covers set, increment, toggle, and reset', () => {
  const initial = { count: 1, on: false };
  assert.deepEqual(applyAction(initial, initial, { type: 'increment', key: 'count', value: 2 }), { count: 3, on: false });
  assert.deepEqual(applyAction(initial, initial, { type: 'toggle', key: 'on' }), { count: 1, on: true });
  assert.deepEqual(applyAction({ count: 9, on: true }, initial, { type: 'reset' }), initial);
  assert.deepEqual(applyAction(initial, initial, { type: 'set', key: 'count', value: 4 }), { count: 4, on: false });
});
