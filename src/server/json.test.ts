import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJSON, inspectJSON } from './json.ts';

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

test('a short leading object does not hide a fuller spec, and the drop is reported', () => {
  const raw = '{"title":"Draft","tree":[{"id":"a","type":"Text"}]}\n{"title":"Full","initialState":{"n":1},"tree":[{"id":"card","type":"Card","children":[{"id":"t","type":"Text"},{"id":"s","type":"Stat"}]}]}';
  const extracted = inspectJSON(raw);
  const parsed = JSON.parse(extracted.json);
  assert.equal(parsed.title, 'Full');
  assert.equal(parsed.tree[0].children.length, 2);
  assert.ok(extracted.warnings.some((warning) => /2 JSON values/.test(warning)));
});

test('trailing prose after one JSON value is reported', () => {
  const extracted = inspectJSON('{"title":"Tip","tree":[]}\nmore text the model added');
  assert.equal(extracted.json, '{"title":"Tip","tree":[]}');
  assert.ok(extracted.warnings.some((warning) => /trailing content/.test(warning)));
});
