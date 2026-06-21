/**
 * Headed demo — opens a REAL Google Chrome window (channel: 'chrome') and drives
 * the playground slowly so you can watch it work: build a counter, generate a
 * live dashboard, then refine it by chat. Records a video and screenshots.
 *
 * Usage: BASE_URL=http://localhost:8080 node scripts/demo.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(DIR, 'screens');
const VIDEO = join(SHOTS, 'video');
mkdirSync(VIDEO, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 550 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: VIDEO, size: { width: 1280, height: 900 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    log(`Opening ${BASE} in Google Chrome…`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    log('0) Landing — no auto-trigger; visitor selects to begin');
    await sleep(1000);
    await page.screenshot({ path: join(SHOTS, 'demo-00-landing.png') });

    // 1) Counter — labels vary in live mode, so use tolerant selectors
    log('1) Counter: increment a few times');
    try {
      await page.getByRole('button', { name: /^counter$/i }).first().click();
      const gen = page.locator('section[aria-label="Generated interface"]');
      const plus = gen.getByRole('button', { name: /(\+|increment|plus)/i }).first();
      await plus.waitFor({ timeout: 25000 });
      for (let i = 0; i < 4; i++) { await plus.click(); await sleep(250); }
      const reset = gen.getByRole('button', { name: /reset/i }).first();
      if (await reset.count()) await reset.click();
      await page.screenshot({ path: join(SHOTS, 'demo-01-counter.png') });
    } catch (e) { log('  (counter step skipped: ' + e.message + ')'); }
    await sleep(800);

    // 2) Live generation — a dashboard with a chart
    log('2) Generate a live dashboard');
    let svgBefore = 0;
    try {
      const box = page.getByRole('textbox').first();
      await box.fill('');
      await box.type('a quarterly sales dashboard with KPI cards and a bar chart of revenue by quarter', { delay: 25 });
      await box.press('Enter');
      await page.waitForSelector('svg, .text-2xl.font-semibold', { timeout: 60000 });
      await sleep(1500);
      svgBefore = await page.locator('svg').count();
      await page.screenshot({ path: join(SHOTS, 'demo-02-dashboard.png') });
    } catch (e) { log('  (dashboard step skipped: ' + e.message + ')'); }

    // 3) Refine it by chat
    log('3) Refine: add a pie chart by region');
    try {
      await page.getByPlaceholder(/make it dark/i).fill('add a pie chart showing revenue split by region');
      await page.getByRole('button', { name: 'Send' }).click();
      for (let i = 0; i < 50; i++) { await sleep(500); if ((await page.locator('svg').count()) !== svgBefore) break; }
      await sleep(1500);
      await page.screenshot({ path: join(SHOTS, 'demo-03-refined.png') });
    } catch (e) { log('  (refine step skipped: ' + e.message + ')'); }

    log('Holding the window open so you can see it…');
    await sleep(5000);

    log(`\nConsole errors: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    console.error('Demo error:', e);
  } finally {
    await context.close(); // finalizes the video
    await browser.close();
    log(`Video + screenshots: ${SHOTS}`);
  }
};

run().catch((e) => {
  console.error('Demo crashed:', e);
  process.exit(1);
});
