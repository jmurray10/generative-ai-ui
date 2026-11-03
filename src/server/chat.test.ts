import assert from 'node:assert/strict';
import test from 'node:test';
import { chatInput, runChat, type ChatModel } from './chat.ts';
import { describeControls, sanitizeActs, type UIControl } from '../shared/control.ts';
import { routeHints } from './route-hints.ts';
import type { Generator } from './types.ts';
import type { UISpec } from '../shared/spec.ts';

const SPEC: UISpec = { title: 'Loan', initialState: { rate: 6.5 }, tree: [{ id: 'r', type: 'Slider', props: { label: 'Rate', stateKey: 'rate', min: 0, max: 15 } }] };
const CONTROLS: UIControl[] = [
  { id: 'set:rate', kind: 'number', label: 'Rate', min: 0, max: 15, value: 6.5 },
  { id: 'call:play', kind: 'action', label: 'play', description: 'Start playback' },
];

function fakeGenerator(name: Generator['name'], refined?: UISpec): Generator {
  return {
    name,
    model: name === 'stub' ? null : 'test',
    generate: async () => refined ?? SPEC,
    refine: async (_p, spec) => refined ?? spec,
    generateApp: async () => SPEC,
  };
}

test('sanitizeActs keeps well-formed acts only, bounded', () => {
  const acts = sanitizeActs([
    { action: 'set:rate', value: 6.25 },
    { action: 'call:play', args: { bpm: 120 } },
    { action: 'rm -rf', value: 1 },
    { action: 'press:go', value: { nested: true } },
    'nope',
  ]);
  assert.deepEqual(acts, [
    { action: 'set:rate', value: 6.25 },
    { action: 'call:play', args: { bpm: 120 } },
    { action: 'press:go' },
  ]);
  assert.equal(sanitizeActs(Array.from({ length: 40 }, () => ({ action: 'press:x' }))).length, 12);
});

test('describeControls lists ids, ranges and actions', () => {
  const text = describeControls(CONTROLS);
  assert.match(text, /set:rate — Rate · number 0\.\.15 · now 6\.5/);
  assert.match(text, /call:play — play · Start playback/);
  assert.match(describeControls([]), /No operable controls/);
});

test('chatInput carries screen, controls, history and the message', () => {
  const input = chatInput({ message: 'set rate to 6', spec: SPEC, readable: 'Rate 6.5%', controls: CONTROLS, history: [{ role: 'user', text: 'hi' }] });
  assert.match(input, /SCREEN \(title: Loan\)/);
  assert.match(input, /CONTROLS:\n- set:rate/);
  assert.match(input, /User: hi/);
  assert.match(input, /MESSAGE: set rate to 6$/);
});

test('runChat returns acts limited to known controls and does not rebuild', async () => {
  const model: ChatModel = async () => ({ reply: 'Set it.', change: 'none', acts: [{ action: 'set:rate', value: 6 }, { action: 'set:unknown', value: 1 }] });
  const out = await runChat({ message: 'rate 6', spec: SPEC, readable: '', controls: CONTROLS }, fakeGenerator('grok'), model);
  assert.deepEqual(out, { reply: 'Set it.', acts: [{ action: 'set:rate', value: 6 }], change: 'none', ok: true });
});

test('runChat refine returns the new spec, and reports a no-op honestly', async () => {
  const model: ChatModel = async () => ({ reply: 'Made it dark.', change: 'refine', instruction: 'dark theme', acts: [] });
  const dark = { ...SPEC, theme: { bg: '#000000' } };
  const changed = await runChat({ message: 'make it dark', spec: SPEC, readable: '', controls: [] }, fakeGenerator('grok', dark), model);
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.spec, dark);
  const same = await runChat({ message: 'make it dark', spec: SPEC, readable: '', controls: [] }, fakeGenerator('grok'), model);
  assert.equal(same.ok, false);
  assert.equal(same.spec, undefined);
});

test('runChat without a chat-capable model never pretends', async () => {
  const out = await runChat({ message: 'hi', spec: SPEC, readable: '', controls: [] }, fakeGenerator('stub'));
  assert.equal(out.ok, false);
});

test('routeHints renders lane, pieces and style; empty without options', () => {
  assert.equal(routeHints(), '');
  const hints = routeHints({ lane: 'sandboxed_react', components: ['table', 'drawer'], style: 'ops_console' });
  assert.match(hints, /exactly ONE ReactArtifact/);
  assert.match(hints, /data table/);
  assert.match(hints, /dense work tool/);
});
