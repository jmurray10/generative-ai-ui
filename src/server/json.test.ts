import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJSON } from './json.ts';

test('extractJSON returns a balanced object and ignores trailing prose', () => {
  const raw = 'Here you go:\n```json\n{"title":"Tip","tree":[{"id":"a","type":"Card"}]}\n```\nHope that helps {not json';
  assert.deepEqual(JSON.parse(extractJSON(raw)), { title: 'Tip', tree: [{ id: 'a', type: 'Card' }] });
});

test('extractJSON does not stop on a brace inside a string', () => {
  const raw = '{"title":"a } b","tree":[]}';
  assert.equal(extractJSON(raw), raw);
});

test('extractJSON prefers the first fenced block that starts with JSON', () => {
  const raw = '```\nnot json\n```\n```json\n[1,{"ok":true}]\n```';
  assert.deepEqual(JSON.parse(extractJSON(raw)), [1, { ok: true }]);
});
