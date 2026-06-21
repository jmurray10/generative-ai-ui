/** Headed: open real Chrome, ask the LIVE model for a bespoke designed UI, and
 *  confirm it comes back as a freeform ReactArtifact that renders. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'domcontentloaded' });
  const box = page.getByRole('textbox').first();
  await box.fill('a beautiful glassmorphism weather card for San Francisco with a gradient sky background, big temperature, and a 4-day forecast row');
  await box.press('Enter');
  await page.waitForSelector('iframe[title="react-artifact"], section[aria-label="Generated interface"]', { timeout: 75000 });
  await sleep(6500); // CDN + transpile + render
  const hasArtifact = await page.locator('iframe[title="react-artifact"]').count();
  console.log('react-artifact present:', hasArtifact);
  console.log('parent console errors:', errors.length);
  await page.screenshot({ path: join(SHOTS, 'design-live.png'), fullPage: true });
  await sleep(3500);
} finally {
  await browser.close();
}
