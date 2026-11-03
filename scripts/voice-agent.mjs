/**
 * Live check of the realtime voice AGENT (no browser, no mic): connect to
 * /voice, init a UI, then send typed turns and play the browser's part —
 * answer read requests with the screen + its controls, and run act requests
 * against a tiny local state. Confirms the agent READS (read_ui), OPERATES
 * (act_ui sets a value without rebuilding) and speaks (audio + transcript).
 *
 *   VOICE_URL=ws://localhost:8080/voice node scripts/voice-agent.mjs
 */
import WebSocket from 'ws';

const TIP_SPEC = {
  title: 'Tip Calculator',
  initialState: { bill: 60, tipPct: 18 },
  tree: [{
    id: 'card', type: 'Card', props: { title: 'Tip Calculator' },
    children: [
      { id: 'b', type: 'Slider', props: { label: 'Bill', stateKey: 'bill', min: 0, max: 300, prefix: '$' } },
      { id: 't', type: 'Slider', props: { label: 'Tip', stateKey: 'tipPct', min: 0, max: 40, suffix: '%' } },
      { id: 's', type: 'Stat', props: { label: 'Total', prefix: '$', decimals: 2 }, bind: { value: 'bill * (1 + tipPct/100)' } },
    ],
  }],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { bill: 60, tipPct: 18 };
const total = () => (state.bill * (1 + state.tipPct / 100)).toFixed(2);
const readable = () => `Tip Calculator. Bill $${state.bill}. Tip ${state.tipPct}%. Total $${total()}.`;
const controls = () => [
  { id: 'set:bill', kind: 'number', label: 'Bill', min: 0, max: 300, value: state.bill },
  { id: 'set:tipPct', kind: 'number', label: 'Tip', min: 0, max: 40, value: state.tipPct },
];

const ws = new WebSocket(process.env.VOICE_URL || 'ws://localhost:8080/voice');
let ready = false, audio = 0, specs = 0, turns = 0, reads = 0, err = '';
const tools = [], ai = [], acts = [];

ws.on('open', () => ws.send(JSON.stringify({ type: 'init', spec: TIP_SPEC, readable: readable() })));
ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  if (m.type === 'ready') { ready = true; ws.send(JSON.stringify({ type: 'text', text: 'Read me the current total.' })); }
  else if (m.type === 'audio') audio++;
  else if (m.type === 'tool') tools.push(m.name);
  else if (m.type === 'spec') specs++;
  else if (m.type === 'readRequest') { reads++; ws.send(JSON.stringify({ type: 'readResponse', id: m.id, readable: readable(), controls: controls() })); }
  else if (m.type === 'actRequest') {
    const results = (m.acts || []).map((a) => {
      const key = String(a.action).replace(/^set:/, '');
      if (a.action.startsWith('set:') && key in state && Number.isFinite(Number(a.value))) {
        state[key] = Number(a.value);
        acts.push(`${a.action}=${a.value}`);
        return { action: a.action, ok: true, detail: `${key} = ${a.value}` };
      }
      return { action: a.action, ok: false, detail: 'unknown control' };
    });
    ws.send(JSON.stringify({ type: 'actResult', id: m.id, results }));
  }
  else if (m.type === 'transcript' && m.who === 'ai' && !m.partial) ai.push(m.text);
  else if (m.type === 'error') err = m.message;
  else if (m.type === 'turnComplete') {
    turns++;
    if (turns === 1) ws.send(JSON.stringify({ type: 'text', text: 'Set the bill to 100 dollars, then tell me the new total.' }));
  }
});
ws.on('error', (e) => { err = String(e?.message || e); });

await sleep(Number(process.env.VOICE_WAIT_MS || 40000));
const said = ai.join(' ');
console.log('ready              :', ready);
console.log('tools called       :', tools.join(', ') || '(none)');
console.log('read round-trips   :', reads);
console.log('acts run           :', acts.join(', ') || '(none)');
console.log('specs rebuilt      :', specs, '(should be 0 — operating, not regenerating)');
console.log('audio chunks       :', audio);
console.log('AI said            :', JSON.stringify(said.slice(0, 300)));
console.log('error              :', err || '(none)');
try { ws.close(); } catch {}
const ok = ready && tools.includes('read_ui') && reads > 0 && acts.includes('set:bill=100') && specs === 0 && audio > 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
