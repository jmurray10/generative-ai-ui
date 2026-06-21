/** Headed: open real Chrome, load the curated Snake, focus it, and play a few
 *  moves so you can watch it run. Screenshot proof in screens/. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 120 });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^snake$/i }).first().click();
  const frame = page.locator('iframe[title="custom-widget"]');
  await frame.waitFor({ timeout: 15000 });
  await sleep(600);
  await frame.click({ position: { x: 200, y: 200 } }); // focus the game
  const seq = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
  for (const k of seq) {
    await page.keyboard.press(k);
    await sleep(450);
  }
  await sleep(1200);
  await page.screenshot({ path: join(SHOTS, 'snake-play.png') });
  console.log(`Snake played. Console errors: ${errors.length}`);
  await sleep(3000);
} finally {
  await browser.close();
}
