import assert from 'node:assert/strict';
import test from 'node:test';
import { bestRound, compactFindings, findArtifactCode, shouldStop } from './critique.ts';

test('compactFindings groups, caps snippets, skips advisory, keeps one description', () => {
  const f = (n: number, ap = 'side-tab') => ({ antipattern: ap, name: ap, description: `d-${ap}`, severity: 'warning', snippet: `s${n}`, line: n });
  const c = compactFindings([f(1), f(2), f(3), f(4), f(5, 'overused-font'), { antipattern: 'em-dash-overuse', severity: 'advisory', advisory: true }]);
  assert.equal(c.count, 5);
  assert.equal(c.groups[0].antipattern, 'side-tab');
  assert.equal(c.groups[0].count, 4);
  assert.equal(c.groups[0].snippets.length, 3);
  assert.match(c.groups[0].snippets[0], /App\.jsx:1/);
  assert.deepEqual(Object.keys(c.descriptions).sort(), ['overused-font', 'side-tab']);
});

test('shouldStop: zero, no improvement, or the round cap', () => {
  const r = (round: number, count: number) => ({ round, count, urlCount: count, dirCount: 0 });
  assert.equal(shouldStop([r(0, 9)]).stop, false);
  assert.equal(shouldStop([r(0, 9), r(1, 0)]).stop, true);
  assert.match(shouldStop([r(0, 9), r(1, 9)]).why, /did not reduce/);
  assert.equal(shouldStop([r(0, 9), r(1, 5), r(2, 3)]).stop, false);
  assert.match(shouldStop([r(0, 9), r(1, 5), r(2, 3), r(3, 1)]).why, /3 fix rounds/);
  assert.equal(bestRound([r(0, 9), r(1, 2), r(2, 4)])?.round, 1);
});

test('findArtifactCode walks the tree', () => {
  const code = findArtifactCode([{ id: 'a', type: 'Stack', children: [{ id: 'b', type: 'ReactArtifact', props: { code: 'function App(){}' } }] }]);
  assert.equal(code, 'function App(){}');
  assert.equal(findArtifactCode([{ id: 'a', type: 'Text' }]), null);
});
