import assert from 'node:assert/strict';
import test from 'node:test';
import { isStepAligned, sliderBounds } from './slider.ts';

test('a typed value past the model max widens the track instead of clamping', () => {
  const bounds = sliderBounds(0, 2000, 4000);
  assert.equal(bounds.max, 4000);
  assert.equal(bounds.widened, true);
});

test('a typed value off the step tick is left off the tick', () => {
  assert.equal(isStepAligned(7.25, 0, 0.1), false);
  assert.equal(isStepAligned(7.3, 0, 0.1), true);
});
