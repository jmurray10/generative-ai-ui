/** Verify the localStorage shim: live-generate a to-do app that persists to
 *  localStorage, then confirm it renders (no sandbox error) and actually works. */
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
try {
  await page.goto(`${BASE}?noauto=1`, { waitUntil: 'domcontentloaded' });
  const box = page.getByRole('textbox').first();
  await box.fill('a to-do list app that lets me add tasks and check them off, persisting to localStorage, designed nicely with Tailwind');
  await box.press('Enter');
  await page.waitForSelector('iframe[title="react-artifact"]', { timeout: 80000 });
  await sleep(6500); // CDN + transpile + render

  const frame = page.frameLocator('iframe[title="react-artifact"]');
  const bodyText = await frame.locator('body').innerText().catch(() => '');
  const hasStorageError = /localStorage/i.test(bodyText) && /(sandbox|allow-same-origin|Failed to read)/i.test(bodyText);
  console.log('artifact shows a localStorage/sandbox error:', hasStorageError);

  // Try to add a task (input + Enter, then any "add" button as fallback)
  let added = false;
  try {
    const input = frame.getByRole('textbox').first();
    if (await input.count()) {
      await input.fill('Buy milk');
      await input.press('Enter');
      await sleep(400);
      const addBtn = frame.getByRole('button', { name: /add|\+/i }).first();
      if ((await frame.getByText(/buy milk/i).count()) === 0 && (await addBtn.count())) {
        await input.fill('Buy milk');
        await addBtn.click();
      }
      await sleep(600);
      added = (await frame.getByText(/buy milk/i).count()) > 0;
    }
  } catch (e) { console.log('  (interaction note: ' + e.message + ')'); }
  console.log('task added & visible inside artifact:', added);
  console.log('parent pageerrors:', errors.length);

  await page.screenshot({ path: join(SHOTS, 'storage-live.png'), fullPage: true });
  await sleep(2500);
} finally {
  await browser.close();
}
