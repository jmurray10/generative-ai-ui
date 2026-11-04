/**
 * Live security checks against a running stack (no model calls, no credits):
 *
 *   BASE_URL=http://localhost:8080 node scripts/security-check.mjs
 *
 * - /voice rejects browsers from other sites (WebSockets aren't covered by CORS).
 * - The API sends no CORS headers unless CORS_ORIGIN is set.
 * - A spec over the size cap is refused before it reaches the model.
 * - A sandboxed app that navigates itself away is taken off screen and loses its
 *   actions; palette colors that aren't hex never reach the page as CSS.
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WS = BASE.replace(/^http/, 'ws') + '/voice';
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
};

function openVoice(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
    ws.on('error', () => resolve('error'));
  });
}

// 1) WebSocket origin rule
check('/voice rejects another site', (await openVoice({ Origin: 'https://evil.example' })) === '403');
check('/voice accepts this site', (await openVoice({ Origin: BASE })) === 'open');

// 2) CORS is opt-in
const pre = await fetch(`${BASE}/api/chat`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
check('no CORS grant for other sites', !pre.headers.get('access-control-allow-origin'), `allow-origin=${pre.headers.get('access-control-allow-origin')}`);

// 3) Spec size cap (refused before any model call)
const big = { title: 'x', tree: [{ id: 'a', type: 'Text', props: { value: 'x'.repeat(300_000) } }] };
const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', spec: big, readable: '', controls: [] }) });
check('oversized spec is refused', r.status === 413, `status ${r.status}`);

// 4) Sandbox navigation + palette, with a mocked build (no model)
const spec = {
  title: 'Nav test',
  design: { direction: 'Test', fonts: 'A', palette: ['#ff6a3d', 'url(https://evil.example/leak)'], signature: 's' },
  tree: [{
    id: 'w', type: 'CustomWidget',
    props: { height: 200, html: '<p>hello</p>', css: '', script: 'genui.expose({ ping: { description: "ping", run: () => "pong" } }); setTimeout(() => { location.href = "https://example.com/"; }, 2500);' },
  }],
};
const sse = (ev, data) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const leaks = [];
page.on('request', (req) => { if (req.url().includes('evil.example')) leaks.push(req.url()); });
await page.route('**/api/decide', (route) => route.fulfill({ json: { decision: { kind: 'hold', reason: 'low_confidence', evidence: {} }, source: 'none', ms: 1, why: [] } }));
await page.route('**/api/stream', (route) => route.fulfill({
  headers: { 'Content-Type': 'text/event-stream' },
  body: sse('progress', { phase: 'design', chars: 10, parts: 0, ms: 5, design: spec.design }) +
    sse('meta', { title: spec.title, design: spec.design, initialState: {}, count: 1, source: 'grok', notices: [] }) +
    sse('node', { index: 0, node: spec.tree[0] }) + sse('done', { spec }),
}));
try {
  await page.goto(BASE);
  const box = page.getByRole('textbox', { name: /describe an interface/i });
  await box.fill('navigation test');
  await box.press('Enter');
  await page.locator('iframe[title="custom-widget"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => window.__genui.controls().map((c) => c.id));
  check('sandbox actions register while the frame is on its own document', before.includes('call:ping'), before.join(','));
  await page.getByText('tried to load another page').waitFor({ timeout: 15000 });
  const after = await page.evaluate(() => window.__genui.controls().map((c) => c.id));
  check('a frame that navigates away is removed and loses its actions', !after.includes('call:ping') && (await page.locator('iframe[title="custom-widget"]').count()) === 0, after.join(',') || '(none)');
  check('non-hex palette values never load as CSS', leaks.length === 0, leaks.join(' '));
} catch (e) {
  check('sandbox navigation check', false, String(e).slice(0, 200));
} finally {
  await browser.close();
}

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: PASS');
process.exit(failures ? 1 : 0);
