/**
 * Opt-in Gemini Live voice agent. Used only when VOICE_PROVIDER=gemini.
 * The default voice path is Grok speech-to-speech (`voice-grok.ts`).
 *
 * This session supports context-window compression and a resumption handle.
 * The current Grok speech-to-speech docs do not expose an equivalent handle,
 * so that behavior stays on this switch.
 */
import { GoogleGenAI } from '@google/genai';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { UISpec } from '../shared/spec.ts';
import { geminiKey, geminiLiveModel, geminiLiveVoice } from './config.ts';
import { getGenerator } from './generator.ts';
import { runVoiceTool, VOICE_SYSTEM } from './voice-tools.ts';

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

interface LiveSession {
  sendToolResponse: (payload: unknown) => void;
  sendRealtimeInput: (payload: unknown) => void;
  sendClientContent: (payload: unknown) => void;
  close: () => void;
}

export function attachGeminiVoice(server: Server, env: NodeJS.ProcessEnv = process.env): void {
  const key = geminiKey(env);
  if (!key) {
    console.log('[voice] gemini selected but no Gemini key — voice disabled');
    return;
  }
  const model = geminiLiveModel(env);
  const voice = geminiLiveVoice(env);
  const ai = new GoogleGenAI({ apiKey: key });
  const generator = getGenerator(env);
  const wss = new WebSocketServer({ server, path: '/voice' });
  console.log(`[voice] Gemini Live voice ready at /voice (model ${model}, voice ${voice}, generator ${generator.name})`);

  wss.on('connection', (ws) => {
    let live: LiveSession | null = null;
    let spec: UISpec = { tree: [] };
    let readable = '';
    let resumptionHandle: string | undefined;
    let closing = false;
    let reconnects = 0;
    let connecting = false;
    const pendingReads = new Map<string, (value: string | null) => void>();
    const send = (payload: unknown) => { try { ws.send(JSON.stringify(payload)); } catch { /* closed */ } };

    const requestRead = (): Promise<string | null> => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { pendingReads.delete(id); resolve(null); }, 2500);
      pendingReads.set(id, (value) => { clearTimeout(timer); resolve(value); });
      send({ type: 'readRequest', id });
    });

    const connectLive = async () => {
      if (connecting) return;
      connecting = true;
      try {
        // The Live SDK's config types lag the fields this session uses (tools,
        // compression, resumption). The cast matches the previous integration.
        live = await ai.live.connect({
          model,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: VOICE_SYSTEM,
            tools: [{ functionDeclarations: TOOL_DECLS }],
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
          },
          callbacks: {
            onopen: () => { reconnects = 0; },
            onmessage: async (msg: {
              setupComplete?: unknown;
              serverContent?: {
                modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string | Uint8Array } }> };
                inputTranscription?: { text?: string };
                outputTranscription?: { text?: string };
                interrupted?: boolean;
                turnComplete?: boolean;
              };
              sessionResumptionUpdate?: { newHandle?: string };
              toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
            }) => {
              if (msg.setupComplete) { send({ type: 'ready' }); return; }
              const parts = msg.serverContent?.modelTurn?.parts ?? [];
              for (const part of parts) {
                if (part.inlineData?.mimeType?.startsWith('audio/')) {
                  const data = typeof part.inlineData.data === 'string'
                    ? part.inlineData.data
                    : Buffer.from(part.inlineData.data ?? []).toString('base64');
                  send({ type: 'audio', audio: data });
                }
              }
              const inputText = msg.serverContent?.inputTranscription?.text;
              if (inputText) send({ type: 'transcript', who: 'user', text: inputText });
              const outputText = msg.serverContent?.outputTranscription?.text;
              if (outputText) send({ type: 'transcript', who: 'ai', text: outputText });
              if (msg.serverContent?.interrupted) send({ type: 'interrupted' });
              if (msg.serverContent?.turnComplete) send({ type: 'turnComplete' });
              if (msg.sessionResumptionUpdate?.newHandle) resumptionHandle = msg.sessionResumptionUpdate.newHandle;
              if (msg.toolCall?.functionCalls?.length) {
                const functionResponses = [];
                for (const call of msg.toolCall.functionCalls) {
                  send({ type: 'tool', name: call.name, args: call.args });
                  const outcome = await runVoiceTool(call.name ?? '', call.args ?? {}, {
                    generator,
                    spec,
                    readable,
                    requestRead,
                  });
                  if (outcome.spec) {
                    spec = outcome.spec;
                    send({ type: 'spec', spec });
                  }
                  functionResponses.push({ id: call.id, name: call.name, response: outcome.result });
                }
                try { live?.sendToolResponse({ functionResponses }); } catch (err) { console.error('[voice] toolResponse', err); }
              }
            },
            onerror: (err: { message?: string } | unknown) => {
              const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : String(err);
              send({ type: 'error', message });
            },
            onclose: () => {
              if (closing || ws.readyState !== 1 || connecting) return;
              if (reconnects < 3) {
                reconnects += 1;
                setTimeout(() => { connectLive().catch(() => {}); }, 300);
              } else {
                send({ type: 'error', message: 'Voice session ended — reconnect to start again.' });
              }
            },
          },
        } as unknown as Parameters<GoogleGenAI['live']['connect']>[0]) as unknown as LiveSession;
      } finally {
        connecting = false;
      }
    };

    ws.on('message', async (buf) => {
      let message: { type?: string; spec?: UISpec; readable?: string; id?: string; audio?: string; text?: string };
      try { message = JSON.parse(buf.toString()); } catch { return; }
      try {
        if (message.type === 'init') {
          spec = message.spec ?? { tree: [] };
          readable = message.readable ?? '';
          if (!live) { await connectLive(); send({ type: 'connected' }); }
        } else if (message.type === 'context') {
          if (message.spec) spec = message.spec;
          if (typeof message.readable === 'string') readable = message.readable;
        } else if (message.type === 'readResponse') {
          const cb = message.id ? pendingReads.get(message.id) : undefined;
          if (cb && message.id) {
            pendingReads.delete(message.id);
            cb(typeof message.readable === 'string' ? message.readable : null);
          }
        } else if (message.type === 'audio' && live && message.audio) {
          live.sendRealtimeInput({ audio: { data: message.audio, mimeType: 'audio/pcm;rate=16000' } });
        } else if (message.type === 'text' && live && message.text) {
          live.sendClientContent({ turns: message.text, turnComplete: true });
        }
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
    });

    const cleanup = () => {
      closing = true;
      for (const cb of pendingReads.values()) cb(null);
      pendingReads.clear();
      try { live?.close(); } catch { /* noop */ }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}
