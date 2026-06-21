/** Spike: does this key have Gemini Live API access? Connect, send a text turn,
 *  confirm we get native-audio chunks + a transcript back. */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!key) { console.error('no key'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });
const model = process.env.LIVE_API_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
console.log('connecting to Live API, model=', model);

let setup = false, audioChunks = 0, transcript = '', closed = '';
try {
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      outputAudioTranscription: {},
      systemInstruction: 'You are a friendly assistant. Answer in five words or fewer.',
    },
    callbacks: {
      onopen: () => console.log('ws open'),
      onmessage: (msg) => {
        if (msg.setupComplete) { setup = true; console.log('setupComplete'); }
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const p of parts) if (p.inlineData?.mimeType?.startsWith('audio/')) audioChunks++;
        const ot = msg.serverContent?.outputTranscription?.text;
        if (ot) transcript += ot;
        if (msg.serverContent?.turnComplete) console.log('turnComplete · audioChunks=', audioChunks, '· transcript=', JSON.stringify(transcript));
      },
      onerror: (e) => console.error('LIVE ERROR:', e?.message || e),
      onclose: (e) => { closed = `${e?.code || ''} ${e?.reason || ''}`; },
    },
  });

  await new Promise((r) => setTimeout(r, 600));
  session.sendClientContent({ turns: 'Say a short friendly hello.', turnComplete: true });
  await new Promise((r) => setTimeout(r, 9000));
  console.log(`\nRESULT: setupComplete=${setup} audioChunks=${audioChunks} transcript=${JSON.stringify(transcript)} close="${closed}"`);
  try { session.close(); } catch {}
  process.exit(setup && audioChunks > 0 ? 0 : 1);
} catch (e) {
  console.error('CONNECT FAILED:', e?.message || e);
  process.exit(2);
}
