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
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await sleep(1200);

    // 1) Counter — actions against the reactive store
    log('1) Counter: click +1 four times, then reset');
    await page.getByRole('button', { name: /^counter$/i }).first().click();
    await page.getByRole('button', { name: '+ 1' }).waitFor({ timeout: 20000 });
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+ 1' }).click();
    await sleep(600);
    await page.getByRole('button', { name: /reset/i }).click();
    await page.screenshot({ path: join(SHOTS, 'demo-01-counter.png') });
    await sleep(800);

    // 2) Live generation — a dashboard with a chart
    log('2) Generate a live dashboard');
    const box = page.getByRole('textbox').first();
    await box.fill('');
    await box.type('a quarterly sales dashboard with KPI cards and a bar chart of revenue by quarter', { delay: 25 });
    await page.getByRole('button', { name: /generate/i }).click();
    await page.waitForSelector('svg, .text-2xl.font-semibold', { timeout: 60000 });
    await sleep(1500);
    const svgBefore = await page.locator('svg').count();
    await page.screenshot({ path: join(SHOTS, 'demo-02-dashboard.png') });

    // 3) Refine it by chat
    log('3) Refine: add a pie chart by region');
    await page.getByPlaceholder(/make it dark/i).fill('add a pie chart showing revenue split by region');
    await page.getByRole('button', { name: 'Send' }).click();
    // wait until the refined UI rebuilds (svg count changes or 25s elapse)
    for (let i = 0; i < 50; i++) {
      await sleep(500);
      const now = await page.locator('svg').count();
      if (now !== svgBefore) break;
    }
    await sleep(1500);
    await page.screenshot({ path: join(SHOTS, 'demo-03-refined.png') });

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
