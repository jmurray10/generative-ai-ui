/** Headed render check for generative theming: confirm a themed registry UI
 *  actually re-colors (the --gp-* vars reach the components). */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 60 });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const gen = async (p) => { const b = page.getByRole('textbox').first(); await b.fill(''); await b.fill(p); await b.press('Enter'); };

const cases = [
  ['a retro arcade high-score board with a counter and reset button (use registry components, not an artifact)', 'theme-retro.png'],
  ['an ocean tides dashboard with sliders and stats (use registry components)', 'theme-ocean.png'],
];
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'domcontentloaded' });
  for (const [prompt, shot] of cases) {
    await gen(prompt);
    await page.waitForSelector('section[aria-label="Generated interface"]', { timeout: 95000 });
    await sleep(3500);
    const info = await page.$eval('section[aria-label="Generated interface"]', (el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, font: cs.fontFamily, vars: el.getAttribute('style') || '' };
    }).catch(() => ({}));
    const themed = !!info.vars && info.vars.includes('--gp-');
    console.log(`[${themed ? 'THEMED' : 'plain '}] ${shot}  bg=${info.bg}  font=${(info.font || '').slice(0, 24)}`);
    await page.screenshot({ path: join(SHOTS, shot) });
  }
} finally {
  await browser.close();
}
