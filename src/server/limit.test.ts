import assert from 'node:assert/strict';
import test from 'node:test';
import { createLimiter } from './limit.ts';

test('limiter allows up to the cap inside the window', () => {
  let now = 1_000;
  const limiter = createLimiter(2, 1_000, () => now);
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), false);
  assert.equal(limiter.allow('b'), true);
  now += 1_001;
  assert.equal(limiter.allow('a'), true);
});
