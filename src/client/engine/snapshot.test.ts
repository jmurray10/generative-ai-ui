import assert from 'node:assert/strict';
import test from 'node:test';
import { digestControls } from './snapshot.ts';

test('typed input and select values are part of the voice snapshot', () => {
  const text = digestControls([
    { type: 'text', name: 'Exchange rate', value: '1.08' },
    { type: 'range', name: 'Amount', value: '40' },
    { type: 'select', name: 'Currency', value: 'EUR' },
    { type: 'checkbox', name: 'Round', value: 'on', checked: false },
  ]);
  assert.equal(text, 'Exchange rate: 1.08 · Currency: EUR · Round: off');
});
