/**
 * Gemini Live voice agent over the generated UI.
 *
 * A WebSocket at /voice bridges the browser to a Gemini Live session (native
 * audio in + out). The model is given three TOOLS so it can act on what the
 * user sees:
 *   - read_ui     → returns the current on-screen text (to read aloud / answer)
 *   - refine_ui   → change the current UI (delegates to the same generator)
 *   - generate_ui → replace the screen with a new UI
 *
 * So voice both READS the data (read_ui → speak) and INTERACTS with it
 * (refine_ui/generate_ui → the screen updates), all through the model.
 */
import { GoogleGenAI } from '@google/genai';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { getGenerator } from './generator.ts';
import type { UISpec } from '../shared/spec.ts';

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = process.env.LIVE_API_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const VOICE = process.env.LIVE_API_VOICE || 'Kore';

const TOOL_DECLS = [
  {
    name: 'read_ui',
    description:
      'Get the current on-screen UI text and data. Call this BEFORE reading the screen aloud or answering any question about what is shown, so you use real values.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'refine_ui',
    description:
      'Change the UI currently on screen. Use for any edit: "make it dark", "add a reset button", "change the tip to 25 percent", "turn the table into a bar chart". Do not just describe the change — call this tool.',
    parameters: {
      type: 'OBJECT',
      properties: { instruction: { type: 'STRING', description: 'the change to make' } },
      required: ['instruction'],
    },
  },
  {
    name: 'generate_ui',
    description: 'Replace the whole screen with a brand-new UI generated from a description (use when the user asks for something entirely different).',
    parameters: { type: 'OBJECT', properties: { prompt: { type: 'STRING' } }, required: ['prompt'] },
  },
];

const SYSTEM = `You are the voice assistant of a generative-UI playground. The user is looking at a UI a model just generated.
- To CHANGE what's on screen, call refine_ui (edits) or generate_ui (something new). Don't just describe it — call the tool, then briefly say what you did.
- Prefer refine_ui for changes to the CURRENT screen; only use generate_ui (a full replace) when the user clearly wants something entirely different.
- To READ the screen aloud or ANSWER a question about it, call read_ui first, then respond concisely from the real values it returns. read_ui always reflects the CURRENT screen, so after an edit you may call it again to confirm the new values.
- If a tool returns ok:false, do NOT claim success — briefly tell the user you couldn't apply that.
Keep spoken replies short and natural. Never invent data — only use what read_ui returns.`;

export function attachVoice(server: Server): void {
  if (!apiKey()) {
    console.log('[voice] no key — Gemini Live voice disabled');
    return;
  }
  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const generator = getGenerator(); // construct once; reuse across connections
  const wss = new WebSocketServer({ server, path: '/voice' });
  console.log(`[voice] Gemini Live voice ready at /voice (model ${MODEL}, voice ${VOICE}, generator ${generator.name})`);

  wss.on('connection', (ws) => {
    let live: any = null;
    let currentSpec: UISpec = { tree: [] };
    let readable = '';
    let resumptionHandle: string | undefined;
    let closing = false;
    let reconnects = 0;
    let connecting = false;
    const pendingReads = new Map<string, (r: string | null) => void>();
    const send = (o: unknown) => { try { ws.send(JSON.stringify(o)); } catch { /* closed */ } };

    // read_ui asks the browser for the CURRENT on-screen text each time, so the
    // agent observes the live state (incl. its own edits), not a stale snapshot.
    function requestRead(): Promise<string | null> {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => { pendingReads.delete(id); resolve(null); }, 2500);
        pendingReads.set(id, (r) => { clearTimeout(timer); resolve(r); });
        send({ type: 'readRequest', id });
      });
    }

    async function runTool(name: string, args: any): Promise<Record<string, unknown>> {
      try {
        if (name === 'read_ui') {
          const fresh = await requestRead();
          return { text: (fresh ?? readable) || 'The screen is currently empty.' };
        }
        if (generator.name !== 'gemini') {
          return { ok: false, error: 'generation is unavailable — no model is connected' };
        }
        if (name === 'generate_ui') {
          const spec = await generator.generate(String(args?.prompt ?? ''));
          currentSpec = spec; send({ type: 'spec', spec });
          return { ok: true, changed: true, title: spec.title ?? 'a new UI' };
        }
        if (name === 'refine_ui') {
          const before = JSON.stringify(currentSpec);
          const spec = await generator.refine(String(args?.instruction ?? ''), currentSpec);
          const changed = JSON.stringify(spec) !== before;
          if (changed) { currentSpec = spec; send({ type: 'spec', spec }); }
          // honest signal: a no-op is reported as a failure so the model won't claim success
          return changed
            ? { ok: true, applied: String(args?.instruction ?? '') }
            : { ok: false, error: 'that change could not be applied — try rephrasing' };
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
      return { ok: false, error: 'unknown tool' };
    }

    async function connectLive() {
      if (connecting) return; // avoid concurrent reconnects racing to assign `live` (orphans a Live session)
      connecting = true;
      try {
        live = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: SYSTEM,
          tools: [{ functionDeclarations: TOOL_DECLS }],
          // keep long voice sessions alive: compress context instead of terminating,
          // and enable resumption handles.
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
        } as any,
        callbacks: {
          onopen: () => { reconnects = 0; }, // reset so the budget means CONSECUTIVE failures
          onmessage: async (msg: any) => {
            if (msg.setupComplete) { send({ type: 'ready' }); return; }
            const parts = msg.serverContent?.modelTurn?.parts ?? [];
            for (const p of parts) {
              if (p.inlineData?.mimeType?.startsWith('audio/')) {
                const data = typeof p.inlineData.data === 'string' ? p.inlineData.data : Buffer.from(p.inlineData.data).toString('base64');
                send({ type: 'audio', audio: data });
              }
            }
            const it = msg.serverContent?.inputTranscription?.text;
            if (it) send({ type: 'transcript', who: 'user', text: it });
            const ot = msg.serverContent?.outputTranscription?.text;
            if (ot) send({ type: 'transcript', who: 'ai', text: ot });
            if (msg.serverContent?.interrupted) send({ type: 'interrupted' });
            if (msg.serverContent?.turnComplete) send({ type: 'turnComplete' });
            if (msg.sessionResumptionUpdate?.newHandle) resumptionHandle = msg.sessionResumptionUpdate.newHandle;
            if (msg.toolCall?.functionCalls?.length) {
              const functionResponses = [];
              for (const fc of msg.toolCall.functionCalls) {
                send({ type: 'tool', name: fc.name, args: fc.args });
                const response = await runTool(fc.name, fc.args);
                functionResponses.push({ id: fc.id, name: fc.name, response });
              }
              try { live.sendToolResponse({ functionResponses }); } catch (e) { console.error('[voice] toolResponse', e); }
            }
          },
          onerror: (e: any) => send({ type: 'error', message: String(e?.message ?? e) }),
          onclose: () => {
            // transparently resume the Live session (e.g. after a goAway/time limit)
            if (closing || ws.readyState !== 1 || connecting) return;
            if (reconnects < 3) {
              reconnects += 1;
              setTimeout(() => connectLive().catch(() => {}), 300);
            } else {
              send({ type: 'error', message: 'Voice session ended — reconnect to start again.' });
            }
          },
        },
        });
      } finally {
        connecting = false;
      }
    }

    ws.on('message', async (buf) => {
      let m: any;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      try {
        if (m.type === 'init') {
          currentSpec = m.spec ?? { tree: [] };
          readable = m.readable ?? '';
          if (!live) { await connectLive(); send({ type: 'connected' }); }
        } else if (m.type === 'context') {
          if (m.spec) currentSpec = m.spec;
          if (typeof m.readable === 'string') readable = m.readable;
        } else if (m.type === 'readResponse') {
          const cb = pendingReads.get(m.id);
          if (cb) { pendingReads.delete(m.id); cb(typeof m.readable === 'string' ? m.readable : null); }
        } else if (m.type === 'audio' && live) {
          live.sendRealtimeInput({ audio: { data: m.audio, mimeType: 'audio/pcm;rate=16000' } });
        } else if (m.type === 'text' && live) {
          live.sendClientContent({ turns: m.text, turnComplete: true });
        }
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      }
    });

    const cleanup = () => {
      closing = true; // stop reconnect attempts once the browser is gone
      for (const cb of pendingReads.values()) cb(null); // resolve+clear any pending read timers
      pendingReads.clear();
      try { live?.close(); } catch { /* noop */ }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}
