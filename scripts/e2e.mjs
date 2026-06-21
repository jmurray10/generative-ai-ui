/**
 * Browser-driven functional test (headless Chromium via Playwright).
 *
 * Renders generated UIs in a real browser and asserts they actually WORK —
 * sliders recompute bound Stats, counter buttons mutate state, the sandboxed
 * iframe mounts, and the live Gemini path renders. Fails on any console error.
 *
 *   GENUI_MODE=engine  -> deterministic engine test (run server in stub mode)
 *   GENUI_MODE=live    -> live generation renders (run server in gemini mode)
 *
 * Usage: BASE_URL=http://localhost:8080 GENUI_MODE=engine node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const MODE = process.env.GENUI_MODE || 'engine';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
}

const statValues = (page) =>
  page.$$eval('.text-2xl.font-semibold', (els) => els.map((e) => e.textContent.trim()));

async function moveSliderToMax(slider) {
  const max = (await slider.getAttribute('max')) || '100';
  await slider.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, max);
}

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /describe an interface/i }).waitFor({ timeout: 10000 });
    check('landing page renders', true);
    await page.screenshot({ path: join(SHOTS, `${MODE}-01-landing.png`) });

    if (MODE === 'engine') {
      // --- Tip calculator: slider recomputes bound Stats -------------------
      await page.getByRole('button', { name: /tip calculator/i }).first().click();
      await page.waitForSelector('input[type=range]', { timeout: 15000 });
      const before = await statValues(page);
      await moveSliderToMax(page.locator('input[type=range]').first());
      await page.waitForTimeout(300);
      const after = await statValues(page);
      check('tip calculator renders sliders + stats', before.length >= 1, `${before.length} stats`);
      check('moving a slider updates a bound Stat', JSON.stringify(before) !== JSON.stringify(after),
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      check('refinement bar present', (await page.getByPlaceholder(/make it dark/i).count()) >= 1);
      await page.screenshot({ path: join(SHOTS, 'engine-02-tip.png') });

      // --- Counter: buttons dispatch state actions -------------------------
      await page.getByRole('button', { name: /^counter$/i }).first().click();
      await page.getByRole('button', { name: '+ 1' }).waitFor({ timeout: 15000 });
      const v0 = parseInt((await statValues(page))[0] || '0', 10);
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+ 1' }).click();
      await page.waitForTimeout(150);
      const v1 = parseInt((await statValues(page))[0] || '0', 10);
      check('counter +1 increments state', v1 === v0 + 3, `${v0} -> ${v1}`);
      await page.getByRole('button', { name: /reset/i }).click();
      await page.waitForTimeout(150);
      const v2 = parseInt((await statValues(page))[0] || '0', 10);
      check('counter reset restores initial', v2 === 0, `value=${v2}`);
      await page.screenshot({ path: join(SHOTS, 'engine-03-counter.png') });

      // --- Sandbox escape hatch: iframe mounts -----------------------------
      await page.getByRole('button', { name: /bouncing ball/i }).first().click();
      await page.waitForSelector('iframe[title="custom-widget"]', { timeout: 15000 });
      const frames = await page.$$('iframe[title="custom-widget"]');
      check('sandboxed CustomWidget iframe mounts', frames.length >= 1, `${frames.length} iframe(s)`);
      await page.screenshot({ path: join(SHOTS, 'engine-04-sandbox.png') });
    } else {
      // --- Live Gemini generation renders + is interactive -----------------
      await page.getByRole('textbox').first().fill(
        'a BMI calculator with sliders for height in cm and weight in kg that shows the BMI',
      );
      await page.getByRole('button', { name: /generate/i }).click();
      await page.waitForSelector('input[type=range]', { timeout: 60000 });
      const before = await statValues(page);
      await moveSliderToMax(page.locator('input[type=range]').first());
      await page.waitForTimeout(300);
      const after = await statValues(page);
      check('live generation renders interactive UI', before.length >= 1, `${before.length} stats`);
      check('live generated UI is reactive', JSON.stringify(before) !== JSON.stringify(after),
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      await page.screenshot({ path: join(SHOTS, 'live-10-bmi.png') });

      // --- Conversational refinement mutates the live UI -------------------
      const beforeText = await page.locator('main').innerText();
      await page.getByPlaceholder(/make it dark/i).fill('add a short note at the very bottom that says Stay healthy');
      await page.getByRole('button', { name: 'Send' }).click();
      let changed = false;
      try {
        await page.getByText(/stay healthy/i).first().waitFor({ timeout: 60000 });
        changed = true;
      } catch {
        changed = (await page.locator('main').innerText()) !== beforeText;
      }
      check('live refinement updates the UI', changed);
      await page.screenshot({ path: join(SHOTS, 'live-11-refine.png') });
    }

    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY (${MODE}): ${results.length - failed.length}/${results.length} passed`);
  console.log(`Screenshots: ${SHOTS}`);
  if (failed.length) process.exit(1);
};

run().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(2);
});
