/** Headed render check for the new features: recharts artifact, multi-step Tabs
 *  app, and a live-data (open-meteo) artifact. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, c, d = '') => { results.push({ n, ok: !!c }); console.log(`${c ? '[PASS]' : '[FAIL]'} ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 80 });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const gen = async (p) => { const b = page.getByRole('textbox').first(); await b.fill(p); await b.press('Enter'); };
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'domcontentloaded' });

  // 1) recharts (a new esm.sh lib)
  await gen('a recharts line chart of weekly active users with several data points');
  await page.waitForSelector('iframe[title="react-artifact"]', { timeout: 80000 });
  await sleep(7500);
  const f1 = page.frameLocator('iframe[title="react-artifact"]');
  const svgs = await f1.locator('svg').count().catch(() => 0);
  const err1 = await f1.locator('pre').count().catch(() => 0);
  check('recharts artifact rendered (svg present, no error pane)', svgs > 0 && err1 === 0, `svg=${svgs} errPane=${err1}`);
  await page.screenshot({ path: join(SHOTS, 'feat-recharts.png') });

  // 2) multi-step Tabs app
  await gen('a 3-screen onboarding flow for a fitness app with welcome, goals and summary screens');
  await page.waitForSelector('section[aria-label="Generated interface"]', { timeout: 95000 });
  await sleep(2500);
  const tabBtns = await page.locator('section[aria-label="Generated interface"] button').count();
  check('multi-step app rendered (tab buttons present)', tabBtns >= 2, `buttons=${tabBtns}`);
  await page.screenshot({ path: join(SHOTS, 'feat-multistep.png') });

  // 3) live-data artifact (open-meteo fetch)
  await gen('a live weather card for Tokyo using the open-meteo API showing the current temperature');
  await page.waitForSelector('iframe[title="react-artifact"]', { timeout: 80000 });
  await sleep(8500);
  const f3 = page.frameLocator('iframe[title="react-artifact"]');
  const body3 = await f3.locator('body').innerText().catch(() => '');
  const err3 = await f3.locator('pre').count().catch(() => 0);
  check('live-data artifact rendered (no error, has content)', err3 === 0 && body3.trim().length > 10, `errPane=${err3} len=${body3.length}`);
  await page.screenshot({ path: join(SHOTS, 'feat-weather.png') });

  check('no parent console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exit(1);
