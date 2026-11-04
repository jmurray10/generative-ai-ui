import assert from 'node:assert/strict';
import test from 'node:test';
import { SpecScanner, type BuildProgress } from './spec-progress.ts';

const SPEC = JSON.stringify({
  design: { direction: 'Swiss grid', fonts: 'Inter Tight / Inter', palette: ['#111', '#f40'], signature: 'a red rule' },
  title: 'Tip "calc"',
  initialState: { bill: 50 },
  tree: [
    { id: 'a', type: 'Card', props: { title: 'Bill {x}' }, children: [{ id: 'b', type: 'Slider', props: { label: 'Bill' } }] },
    { id: 'c', type: 'ReactArtifact', props: { code: 'const s = "}]"; export default () => <div>{s}</div>' } },
  ],
});

function feed(text: string, size: number): BuildProgress[] {
  const s = new SpecScanner();
  const all: BuildProgress[] = [];
  for (let i = 0; i < text.length; i += size) all.push(...s.push(text.slice(i, i + size)));
  return all;
}

for (const size of [1, 7, 64, 10_000]) {
  test(`scanner finds the brief, title and parts (chunk ${size})`, () => {
    const events = feed(SPEC, size);
    const design = events.find((e) => e.design)?.design;
    assert.equal(design?.direction, 'Swiss grid');
    assert.equal(events.find((e) => e.title)?.title, 'Tip "calc"');
    const parts = events.filter((e) => e.part).map((e) => e.part);
    assert.deepEqual(parts, [{ type: 'Card', label: 'Bill {x}' }, { type: 'ReactArtifact', label: '' }]);
    assert.equal(events.at(-1)?.phase, 'finishing');
    assert.equal(events.at(-1)?.parts, 2);
  });
}

test('the early brief keeps only hex palette colors (no url() reaches the page)', () => {
  const s = new SpecScanner();
  const events = s.push(JSON.stringify({ design: { direction: 'X', fonts: 'A', palette: ['#111', 'url(https://evil.example/?q=1)', 'red', '#ff6a3d'], signature: 's' }, tree: [] }));
  assert.deepEqual(events.find((e) => e.design)?.design?.palette, ['#111', '#ff6a3d']);
});

test('phases move from thinking through building', () => {
  const s = new SpecScanner();
  assert.equal(s.snapshot().phase, 'thinking');
  s.push('{"design":{"direction":"x"');
  assert.equal(s.snapshot().phase, 'design');
  s.push(',"fonts":"a","palette":[],"signature":"s"},"title":"T","tree":[{"id":"a","type":"Text"}');
  assert.equal(s.snapshot().phase, 'building');
  assert.equal(s.snapshot().parts, 1);
});
