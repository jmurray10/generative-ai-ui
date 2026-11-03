/**
 * End-to-end test of LIVE generation and live interaction (needs a running
 * server with XAI_API_KEY; Docker or `npm start`).
 *
 * There are no canned specs — every UI here is generated on the fly. The test
 * checks the full loop: Jev routes the prompt, Grok builds it, and then CHAT
 * operates the built UI in place (registry state and a sandboxed app's exposed
 * actions) instead of regenerating it. Assertions are about shape, not exact
 * output, because the model's output legitimately varies.
 *
 * Usage: BASE_URL=http://localhost:8080 node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'screens');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
};

const controls = (page) => page.evaluate(() => window.__genui.controls());
const logText = (page) => page.locator('[role=log]').innerText();

async function waitBuilt(page, timeout = 150000) {
  await page.locator('[aria-label="Design brief"]').waitFor({ timeout });
  await page.getByText('Assembling the interface').waitFor({ state: 'hidden', timeout });
  await sleep(1500);
}

async function sendChat(page, text, until, timeout = 60000) {
  const before = await logText(page);
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-input').press('Enter');
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(500);
    const now = await logText(page);
    const busy = await page.getByLabel('Thinking').count();
    if (!busy && now.length > before.length + text.length && until(now.slice(before.length))) return now.slice(before.length);
  }
  return (await logText(page)).slice(before.length);
}

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /describe an interface/i }).waitFor({ timeout: 10000 });
    const cards = await page.locator('section[aria-labelledby=gallery-title] button').count();
    check('landing renders with the example gallery', cards >= 6, `${cards} cards`);

    // 1) Typed prompt -> Jev decision -> registry UI -> chat sets a value in place
    const box = page.getByRole('textbox', { name: /describe an interface/i });
    await box.fill('a tip calculator with sliders for bill, tip percent and number of people, showing the total and per-person amount');
    await box.press('Enter');
    await page.getByText('Toolbox decision').waitFor({ timeout: 30000 });
    const decision = await page.locator('aside').innerText();
    check('Jev decision card shows a route', /Registry \+ state|React sandbox/.test(decision), decision.split('\n').slice(0, 4).join(' / '));
    await waitBuilt(page);
    const brief = await page.locator('[aria-label="Design brief"]').innerText();
    check('model committed to a design brief', /Direction/.test(brief), brief.split('\n')[0]);
    const c1 = await controls(page);
    const billKey = c1.find((c) => c.kind === 'number' && /bill/i.test(c.id + c.label));
    check('registry controls are exposed to chat/voice', Boolean(billKey), c1.map((c) => c.id).join(', '));
    const titleBefore = await page.locator('main h1').innerText();
    const reply = await sendChat(page, 'Set the bill to 120 dollars', (t) => /=|failed/.test(t));
    const after = billKey ? (await controls(page)).find((c) => c.id === billKey.id) : null;
    const provAfter = await page.locator('main p').first().innerText();
    check('chat operated the UI in place (no rebuild)', after?.value === 120 && !/Refined/.test(provAfter) && (await page.locator('main h1').innerText()) === titleBefore,
      `${billKey?.id} -> ${after?.value}; ${reply.replace(/\s+/g, ' ').slice(0, 120)}`);
    await page.screenshot({ path: join(SHOTS, 'e2e-1-registry-chat.png') });

    // 2) Gallery example -> sandboxed app that exposes actions -> chat calls one
    await page.getByRole('button', { name: /start over/i }).click();
    await page.getByRole('button', { name: /^Snake/ }).click();
    await waitBuilt(page);
    await page.locator('iframe[title="react-artifact"], iframe[title="custom-widget"]').first().waitFor({ timeout: 30000 });
    let actions = [];
    for (let i = 0; i < 30 && !actions.length; i++) {
      await sleep(500);
      actions = (await controls(page)).filter((c) => c.id.startsWith('call:'));
    }
    check('sandboxed app exposed actions via genui.expose', actions.length > 0, actions.map((a) => a.id).join(', '));
    const errPane = await page.frameLocator('iframe[title="react-artifact"]').locator('#root > pre').count().catch(() => 0);
    check('sandboxed app rendered clean', errPane === 0);
    const r2 = await sendChat(page, 'Pause the game', (t) => /\(\)|failed/.test(t));
    check('chat called an app action inside the sandbox', /\w+\(\)/.test(r2), r2.replace(/\s+/g, ' ').slice(0, 140));
    await page.screenshot({ path: join(SHOTS, 'e2e-2-sandbox-act.png') });

    check('no parent console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`Screenshots: ${SHOTS}`);
  if (failed.length) process.exit(1);
};

run().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(2);
});
