/**
 * Renders both artifact lanes in Chromium. A CSP that blocks Babel's
 * `new Function` or the module lane's blob import fails this test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import { buildArtifactDoc } from './components.tsx';

async function renderArtifact(page: Page, doc: string, text: string): Promise<void> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const line = msg.text();
    if (/content security policy|violates the following|refused to/i.test(line)) problems.push(line);
  });
  page.on('pageerror', (err) => problems.push(String(err)));
  await page.setContent(doc, { waitUntil: 'domcontentloaded' });
  await page.getByText(text, { exact: true }).waitFor({ timeout: 45000 });
  const root = (await page.locator('#root').innerText()).trim();
  assert.ok(root.length > 0, 'artifact root is blank');
  assert.equal(await page.locator('#root pre').count(), 0, 'artifact rendered an error pane');
  assert.deepEqual(problems, [], problems.join('\n'));
}

test('classic React artifact renders and does not trip CSP', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const doc = buildArtifactDoc('function App(){ return <p>Classic artifact ok</p>; }');
    await renderArtifact(page, doc, 'Classic artifact ok');
  } finally {
    await browser.close();
  }
});

test('import-style React artifact renders and does not trip CSP', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const doc = buildArtifactDoc("import React from 'react';\nfunction App(){ return <p>Module artifact ok</p>; }");
    await renderArtifact(page, doc, 'Module artifact ok');
  } finally {
    await browser.close();
  }
});
