/** Full-page proof capture: generate a dashboard, then refine it, screenshotting
 *  the WHOLE page each time and reporting the SVG (chart) count delta. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox').first().fill('a quarterly sales dashboard with KPI cards and a bar chart of revenue by quarter');
  await page.getByRole('button', { name: /generate/i }).click();
  await page.waitForSelector('svg', { timeout: 60000 });
  await sleep(1500);
  const before = await page.locator('svg').count();
  await page.screenshot({ path: join(SHOTS, 'cap-01-dashboard.png'), fullPage: true });

  await page.getByPlaceholder(/make it dark/i).fill('add a pie chart showing revenue split by region: North, South, East, West');
  await page.getByRole('button', { name: 'Send' }).click();
  for (let i = 0; i < 70; i++) {
    await sleep(500);
    if ((await page.locator('svg').count()) !== before) break;
  }
  await sleep(1500);
  const after = await page.locator('svg').count();
  await page.screenshot({ path: join(SHOTS, 'cap-02-refined.png'), fullPage: true });
  console.log(`SVG charts: before=${before} after=${after} (refine ${after > before ? 'ADDED a chart' : 'no chart count change'})`);
} finally {
  await browser.close();
}
