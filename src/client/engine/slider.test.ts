import assert from 'node:assert/strict';
import test from 'node:test';
import { isStepAligned, parseTypedNumber, sliderBounds } from './slider.ts';

test('a typed value past the model max widens the track instead of clamping', () => {
  const bounds = sliderBounds(0, 2000, 4000);
  assert.equal(bounds.max, 4000);
  assert.equal(bounds.widened, true);
});

test('a typed value off the step tick is left off the tick', () => {
  assert.equal(isStepAligned(7.25, 0, 0.1), false);
  assert.equal(isStepAligned(7.3, 0, 0.1), true);
});

test('the number box can be empty or just a minus while typing', () => {
  assert.deepEqual(parseTypedNumber(''), { partial: true });
  assert.deepEqual(parseTypedNumber('-'), { partial: true });
  assert.deepEqual(parseTypedNumber('-5000'), { partial: false, value: -5000 });
  assert.deepEqual(parseTypedNumber('0400000'), { partial: false, value: 400000 });
});
