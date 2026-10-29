import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArtifactDoc, customWidgetSrcDoc } from './components.tsx';

test('custom widget documents block network and neutralize a script closer', () => {
  const doc = customWidgetSrcDoc('<p>Hi</p>', 'body{}', 'alert(1)</script><script>alert(2)');
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /connect-src 'none'/);
  assert.doesNotMatch(doc, /unsafe-eval/);
  assert.match(doc, /<\\\/script>/);
});

test('react artifact CSP allows Babel eval and blob modules, not every origin', () => {
  const classic = buildArtifactDoc('function App(){ return <div>Hi</div>; }');
  assert.match(classic, /https:\/\/unpkg.com/);
  assert.match(classic, /https:\/\/cdn.tailwindcss.com/);
  assert.match(classic, /unsafe-eval/);
  assert.match(classic, /blob:/);

  const modular = buildArtifactDoc("import React from 'react';\nfunction App(){ return <div/> }");
  assert.match(modular, /https:\/\/esm.sh/);
  assert.match(modular, /importmap/);
  assert.match(modular, /blob:/);
  const policy = modular.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.match(policy, /connect-src [^;]*https:\/\/esm\.sh/);
  assert.doesNotMatch(policy, /connect-src https:(?:\s|;|$)/);
});
