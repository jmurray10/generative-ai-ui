import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTranscript, type TranscriptLine } from './transcript.ts';

function fold(events: TranscriptLine[]): TranscriptLine[] {
  return events.reduce<TranscriptLine[]>((lines, event) => applyTranscript(lines, event), []);
}

test('partial user transcript updates replace the in-progress line', () => {
  const lines = fold([
    { who: 'user', text: 'What is the', partial: true },
    { who: 'user', text: 'What is the current count?', partial: true },
    { who: 'user', text: 'What is the current count?', partial: true },
    { who: 'user', text: 'What is the current count?', partial: false },
  ]);
  assert.deepEqual(lines, [{ who: 'user', text: 'What is the current count?', partial: false }]);
});

test('duplicate finals of one utterance still collapse to one line', () => {
  const lines = fold([
    { who: 'user', text: 'What is the', partial: false },
    { who: 'user', text: 'What is the current count?', partial: false },
    { who: 'user', text: 'What is the current count?', partial: false },
    { who: 'user', text: 'What is the current count?', partial: false },
  ]);
  assert.deepEqual(lines, [{ who: 'user', text: 'What is the current count?', partial: false }]);
});

test('a new sentence after a finished one is its own line', () => {
  const lines = fold([
    { who: 'user', text: 'What is the current count?', partial: false },
    { who: 'ai', text: 'The current count is zero.', partial: false },
    { who: 'user', text: 'Make it dark', partial: true },
    { who: 'user', text: 'Make it dark please', partial: false },
  ]);
  assert.deepEqual(lines.map((line) => line.text), [
    'What is the current count?',
    'The current count is zero.',
    'Make it dark please',
  ]);
});

test('the same xAI item id updates one line even after another speaker', () => {
  const lines = fold([
    { who: 'user', text: 'What is the', partial: true, itemId: 'item_1' },
    { who: 'ai', text: 'Listening', partial: true, itemId: 'item_a' },
    { who: 'user', text: 'What is the current count?', partial: false, itemId: 'item_1' },
  ]);
  assert.equal(lines.filter((line) => line.who === 'user').length, 1);
  assert.equal(lines.find((line) => line.who === 'user')?.text, 'What is the current count?');
});
