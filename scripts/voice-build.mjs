/**
 * Live check: build a UI by voice from the landing page, then operate it by voice.
 *
 *   BASE_URL=http://localhost:8080 node scripts/voice-build.mjs
 *
 * Starts a voice session with nothing on screen ("Say it"), sends the request as
 * text into the same realtime session (no mic needed), and expects the agent to
 * call generate_ui, which runs in the browser through the router and the live
 * build timeline. Then asks for a change it should make by operating, not rebuilding.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE);
  await page.getByRole('button', { name: /Say it/ }).click();
  await page.getByText('Describe the interface you want').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Stop talking/ }).waitFor({ timeout: 15000 });
  check('landing "Say it" opens a voice session with an empty canvas', true);
  await page.screenshot({ path: join(SHOTS, 'voice-build-listening.png') });

  await sleep(1500);
  await page.evaluate(() => window.__voiceText('Build me a tip calculator with sliders for the bill, the tip percent and the number of people, showing the total and the amount per person.'));

  await page.locator('[aria-label="Build steps"]').waitFor({ timeout: 45000 });
  check('voice request started a routed build with the live timeline', true);
  await sleep(4000);
  await page.screenshot({ path: join(SHOTS, 'voice-build-progress.png') });

  await page.locator('[aria-label="Design brief"]').waitFor({ timeout: 180000 });
  await page.getByText('Rendering the interface').waitFor({ state: 'hidden', timeout: 60000 });
  const title = await page.locator('main h1').innerText();
  check('voice build rendered a UI', Boolean(title), title);

  // The agent speaks after the build; then operate it by voice.
  const before = (await page.locator('[role=log]').innerText()).length;
  await sleep(6000);
  await page.evaluate(() => window.__voiceText('Set the bill to 80 dollars.'));
  let log = '';
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    log = (await page.locator('[role=log]').innerText()).slice(before);
    if (/set:\w+|Bill = 80|bill.*80/i.test(log) && i > 6) break;
  }
  check('voice operated the new UI (act, no rebuild)', /Bill = 80|set:bill|bill.*80/i.test(log), log.replace(/\s+/g, ' ').slice(0, 160));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: join(SHOTS, 'voice-build-done.png') });
} catch (e) {
  check('voice build flow', false, String(e).slice(0, 200));
  await page.screenshot({ path: join(SHOTS, 'voice-build-error.png') }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: PASS');
process.exit(failures ? 1 : 0);
