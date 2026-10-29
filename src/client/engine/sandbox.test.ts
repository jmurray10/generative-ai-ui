import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArtifactDoc, customWidgetSrcDoc } from './components.tsx';

test('custom widget documents block network and neutralize a script closer', () => {
  const doc = customWidgetSrcDoc('<p>Hi</p>', 'body{}', 'alert(1)</script><script>alert(2)');
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.doesNotMatch(doc, /connect-src/);
  assert.match(doc, /<\\\/script>/);
});

test('react artifact documents allow the CDN hosts the runtime loads', () => {
  const classic = buildArtifactDoc('function App(){ return <div>Hi</div>; }');
  assert.match(classic, /https:\/\/unpkg.com/);
  assert.match(classic, /https:\/\/cdn.tailwindcss.com/);
  assert.match(classic, /Content-Security-Policy/);

  const modular = buildArtifactDoc("import React from 'react';\nfunction App(){ return <div/> }");
  assert.match(modular, /https:\/\/esm.sh/);
  assert.match(modular, /importmap/);
});
