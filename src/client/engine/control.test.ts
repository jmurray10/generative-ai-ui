import assert from 'node:assert/strict';
import test from 'node:test';
import { coerceValue, parseFrameActions, registryControls } from './control.ts';
import type { UISpec } from '../../shared/spec.ts';

const SPEC: UISpec = {
  initialState: { rate: 6.5, term: 30, dark: false, count: 2 },
  tree: [
    {
      id: 'card',
      type: 'Card',
      children: [
        { id: 'r', type: 'Slider', props: { label: 'Rate', stateKey: 'rate', min: 0, max: 15 } },
        { id: 't', type: 'Select', props: { label: 'Term', stateKey: 'term', options: [{ label: '15y', value: 15 }, { label: '30y', value: 30 }] } },
        { id: 'd', type: 'Toggle', props: { label: 'Dark', stateKey: 'dark' } },
        { id: 'go', type: 'Button', props: { label: 'Reset', action: { type: 'reset' } } },
      ],
    },
  ],
};

test('registryControls derives inputs, buttons and leftover state', () => {
  const ids = registryControls(SPEC, SPEC.initialState!).map((c) => `${c.id}:${c.kind}`);
  assert.deepEqual(ids, ['set:rate:number', 'set:term:choice', 'set:dark:boolean', 'press:go:button', 'set:count:number']);
  const rate = registryControls(SPEC, SPEC.initialState!)[0];
  assert.equal(rate.min, 0);
  assert.equal(rate.max, 15);
});

test('coerceValue clamps numbers, parses text, matches choices and booleans', () => {
  const [rate, term, dark] = registryControls(SPEC, SPEC.initialState!);
  assert.deepEqual(coerceValue(rate, '6.25%'), { value: 6.25 });
  assert.deepEqual(coerceValue(rate, 99), { value: 15 });
  assert.ok('error' in coerceValue(rate, 'lots'));
  assert.deepEqual(coerceValue(term, '15'), { value: 15 });
  assert.ok('error' in coerceValue(term, 40));
  assert.deepEqual(coerceValue(dark, 'on'), { value: true });
  assert.ok('error' in coerceValue(dark, 'maybe'));
});

test('parseFrameActions keeps named actions and drops junk', () => {
  const parsed = parseFrameActions({ __genuiActions: [{ name: 'play', description: 'Start' }, { name: 'bad name!' }, { nope: 1 }, { name: 'setTempo', params: { bpm: 'number' } }] });
  assert.deepEqual(parsed, [{ name: 'play', description: 'Start' }, { name: 'setTempo', params: { bpm: 'number' } }]);
  assert.equal(parseFrameActions({ other: 1 }), null);
});
