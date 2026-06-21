/** Headed Chrome: open the Gemini Live Voice panel and drive it via typed
 *  commands (no mic). Verifies the model speaks (AI transcript) AND changes the
 *  UI (spec updates) through tool calls. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 150 });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 980 } }); // no mic permission → text-only
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'domcontentloaded' });
  const box = page.getByRole('textbox').first();
  await box.fill('a tip calculator with sliders for bill, tip percent and people, showing the total');
  await box.press('Enter');
  await page.waitForSelector('input[type=range]', { timeout: 75000 });
  await sleep(1000);

  const genText = () => page.locator('section[aria-label="Generated interface"]').innerText().catch(() => '');
  const before = await genText();

  // open the voice panel
  await page.getByRole('button', { name: /voice/i }).first().click();
  await page.getByText(/Gemini Voice/i).waitFor({ timeout: 15000 });
  // wait for the live session + text hook
  for (let i = 0; i < 30; i++) { if (await page.evaluate(() => typeof window.__voiceText === 'function')) break; await sleep(500); }
  await sleep(2500); // let the WS reach "ready"

  // a voice-style command that READS + CHANGES the data
  const cmd = page.getByPlaceholder('type a command…');
  await cmd.fill('Change the tip to 30 percent and make the card dark, then tell me the new total.');
  await cmd.press('Enter');

  let aiSpoke = false, uiChanged = false;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    if ((await page.locator('text=/Gemini:/').count()) > 0) aiSpoke = true;
    if ((await genText()) !== before) uiChanged = true;
    if (aiSpoke && uiChanged) break;
  }
  console.log('Gemini spoke (AI transcript present):', aiSpoke);
  console.log('UI changed via voice tool call      :', uiChanged);
  console.log('parent pageerrors                   :', errors.length);
  await page.screenshot({ path: join(SHOTS, 'voice-live.png') });
  await sleep(2500);
  console.log('\nRESULT:', aiSpoke && uiChanged ? 'PASS' : 'PARTIAL');
} finally {
  await browser.close();
}
