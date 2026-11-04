/**
 * Synthesize a spoken prompt with Grok's realtime voice and save it as a 16-bit
 * mono WAV (24 kHz) — used as the fake microphone in demo recordings.
 *
 *   npx tsx scripts/speak.ts "Set the rate to six percent." out.wav [voice=leo] [leadSilenceMs=1500]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { grokVoiceModel, xaiKey, xaiRealtimeURL } from '../src/server/config.ts';

const [text, out, voice = 'leo', lead = '1500'] = process.argv.slice(2);
if (!text || !out) {
  console.error('usage: speak.ts "<text>" <out.wav> [voice] [leadSilenceMs]');
  process.exit(2);
}
const key = xaiKey();
if (!key) throw new Error('XAI_API_KEY is not set');

const RATE = 24000;
const chunks: Buffer[] = [];
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(xaiRealtimeURL(grokVoiceModel()), { headers: { Authorization: `Bearer ${key}` } });
  const timer = setTimeout(() => { ws.close(); reject(new Error('timed out')); }, 45000);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        voice,
        instructions: 'You are a voice actor. Say the user\'s line exactly as written, once, naturally, with no additions.',
        turn_detection: null,
        audio: { output: { format: { type: 'audio/pcm', rate: RATE } } },
      },
    }));
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Line: ${text}` }] } }));
    ws.send(JSON.stringify({ type: 'response.create' }));
  });
  ws.on('message', (data) => {
    const e = JSON.parse(data.toString()) as { type?: string; delta?: string; audio?: string; error?: { message?: string } };
    if ((e.type === 'response.output_audio.delta' || e.type === 'response.audio.delta') && (e.delta || e.audio)) chunks.push(Buffer.from((e.delta || e.audio) as string, 'base64'));
    if (e.type === 'response.done') { clearTimeout(timer); ws.close(); resolve(); }
    if (e.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error(e.error?.message || 'voice error')); }
  });
  ws.on('error', reject);
});

const leadBytes = Math.round((Number(lead) / 1000) * RATE) * 2;
const tail = RATE * 2; // 1 s of trailing silence so server VAD closes the turn
const pcm = Buffer.concat([Buffer.alloc(leadBytes), ...chunks, Buffer.alloc(tail)]);
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out}: ${(pcm.length / 2 / RATE).toFixed(2)} s (${chunks.length} chunks, voice ${voice})`);
