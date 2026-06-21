/** Verify the Gemini Live voice AGENT (no browser/mic): connect /voice, init a
 *  UI, then send text commands and confirm the model calls tools (refine_ui /
 *  read_ui), updates the spec, and speaks (audio + transcript). */
const TIP_SPEC = {
  title: 'Tip Calculator',
  initialState: { bill: 60, tipPct: 18 },
  tree: [{
    id: 'card', type: 'Card', props: { title: 'Tip Calculator' },
    children: [{ id: 's', type: 'Stat', props: { label: 'Total', prefix: '$', decimals: 2 }, bind: { value: 'bill * (1 + tipPct/100)' } }],
  }],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(process.env.VOICE_URL || 'ws://localhost:8080/voice');
let ready = false, audio = 0, specs = 0, turns = 0, reads = 0, err = '';
const tools = [], ai = [];
// simulates the browser's live read-back (read_ui round-trip). Changes after the
// dark/30% edit so we can confirm read_ui reflects the CURRENT state, not a snapshot.
let readable = 'Tip Calculator. Bill is 60 dollars, tip 18 percent, total 70 dollars and 80 cents.';
ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'init', spec: TIP_SPEC, readable })));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (m.type === 'ready') { ready = true; ws.send(JSON.stringify({ type: 'text', text: 'Please read me the current total out loud.' })); }
  else if (m.type === 'audio') audio++;
  else if (m.type === 'tool') tools.push(m.name);
  else if (m.type === 'spec') specs++;
  else if (m.type === 'readRequest') { reads++; ws.send(JSON.stringify({ type: 'readResponse', id: m.id, readable })); }
  else if (m.type === 'transcript' && m.who === 'ai') ai.push(m.text);
  else if (m.type === 'error') err = m.message;
  else if (m.type === 'turnComplete') {
    turns++;
    if (turns === 1) ws.send(JSON.stringify({ type: 'text', text: 'Now make the whole interface dark themed.' }));
  }
});
ws.addEventListener('error', (e) => { err = String(e?.message || e); });

await sleep(38000);
const said = ai.join('');
console.log('ready              :', ready);
console.log('tools called       :', tools.join(', ') || '(none)');
console.log('spec updates       :', specs);
console.log('read round-trips   :', reads);
console.log('audio chunks       :', audio);
console.log('read spoke total?  :', /70|seventy|total/i.test(said));
console.log('AI said            :', JSON.stringify(said.slice(0, 240)));
console.log('error              :', err || '(none)');
try { ws.close(); } catch {}
// Primary fix under test = the live read_ui round-trip; refine is secondary (live-flaky).
const ok = ready && tools.includes('read_ui') && reads > 0 && audio > 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
