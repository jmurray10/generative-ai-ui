import assert from 'node:assert/strict';
import test from 'node:test';
import { isMultiScreenPrompt } from './screen-route.ts';

test('a quiz and a flow field stay single-screen', () => {
  assert.equal(isMultiScreenPrompt('a quiz: 3 questions about space with a score'), false);
  assert.equal(isMultiScreenPrompt('a generative flow field of particles'), false);
  assert.equal(isMultiScreenPrompt('a cash flow calculator'), false);
  assert.equal(isMultiScreenPrompt('a customer survey form'), false);
});

test('decks, wizards, and explicit multi-page asks still split', () => {
  assert.equal(isMultiScreenPrompt('a slide deck about the quarter'), true);
  assert.equal(isMultiScreenPrompt('an onboarding wizard for new hires'), true);
  assert.equal(isMultiScreenPrompt('a 4 step checkout flow'), true);
  assert.equal(isMultiScreenPrompt('a multi-page survey'), true);
  assert.equal(isMultiScreenPrompt('several screens for a product tour'), true);
});
