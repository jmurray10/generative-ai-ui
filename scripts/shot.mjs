/** Capture a README hero screenshot: type a prompt, let a themed UI build itself,
 *  screenshot the viewport into docs/demo.png. Needs the container running with a
 *  live GEMINI key (GENERATOR=gemini). */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const PROMPT = process.env.SHOT_PROMPT ||
  'a vibrant personal finance dashboard: a savings-goal progress bar, KPI stat cards, a bar chart of spending by category, and a slider to adjust the monthly contribution';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'demo.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 2 });
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox').first().fill(PROMPT);
  await page.getByRole('button', { name: /generate/i }).click();

  // the refine bar appears once a spec has rendered
  await page.getByPlaceholder(/make it dark/i).waitFor({ state: 'visible', timeout: 90000 });
  // wait for a chart to stream in (best-effort completion signal), then settle
  await page.waitForSelector('svg', { timeout: 20000 }).catch(() => {});
  await sleep(6000); // let streaming + theming fully settle

  const full = process.env.SHOT_FULL === '1';
  await page.screenshot({ path: OUT, fullPage: full });
  console.log(`saved ${OUT} (fullPage=${full})`);
} finally {
  await browser.close();
}
