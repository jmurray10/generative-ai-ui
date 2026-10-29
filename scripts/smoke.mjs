/**
 * Offline UI smoke. Does not call a model. Proves the shell renders and that a
 * prompt with no key shows the connect-a-model notice rather than a canned UI.
 *
 *   BASE_URL=http://localhost:8080 node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const shots = new URL('./screens/', import.meta.url);
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /describe an interface/i }).waitFor();
  await page.screenshot({ path: new URL('./screens/smoke-landing.png', import.meta.url).pathname, fullPage: true });

  const examples = page.getByRole('button', { name: 'Tip calculator' });
  await examples.first().waitFor();

  const box = page.getByRole('textbox', { name: /describe an interface/i });
  await box.fill('a counter');
  await box.press('Enter');
  await page.getByText(/XAI_API_KEY/).waitFor({ timeout: 20000 });
  await page.getByText(/Offline — connect a model/).waitFor();
  await page.screenshot({ path: new URL('./screens/smoke-stub.png', import.meta.url).pathname, fullPage: true });

  await page.getByRole('button', { name: 'Open voice assistant' }).first().click();
  await page.getByRole('dialog', { name: /assistant/i }).waitFor();
  await page.getByText(/Voice is off/).waitFor({ timeout: 10000 });
  await page.screenshot({ path: new URL('./screens/smoke-voice.png', import.meta.url).pathname, fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('[PASS] offline UI smoke');
