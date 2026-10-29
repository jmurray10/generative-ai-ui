/**
 * Grok speech-to-speech bridge.
 *
 * Browser `/voice` WebSocket  ↔  `wss://api.x.ai/v1/realtime?model=grok-voice-latest`
 * (`grok-voice-latest` routes to `grok-voice-think-fast-2.0` in the Oct 10, 2026 docs).
 *
 * The browser already streams 16 kHz PCM up and plays 24 kHz PCM down (the same
 * rates Gemini Live used). The session pins those rates so the client audio
 * path does not change. Tool calls (`read_ui`, `refine_ui`, `generate_ui`) are
 * answered here and handed back as `function_call_output`.
 *
 * xAI's current speech-to-speech docs do not describe Gemini-style session
 * resumption handles. A dropped socket opens a fresh session.
 */
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { UISpec } from '../shared/spec.ts';
import {
  grokVoiceModel,
  grokVoiceName,
  grokVoiceReasoning,
  xaiKey,
  xaiRealtimeURL,
} from './config.ts';
import { getGenerator } from './generator.ts';
import { GROK_VOICE_TOOLS, runVoiceTool, VOICE_SYSTEM } from './voice-tools.ts';

export interface MappedVoiceEvent {
  toClient: Array<Record<string, unknown>>;
  assistantTranscript: string;
  functionCall?: { name: string; callId: string; arguments: string };
  ready?: boolean;
}

function audioDelta(event: Record<string, unknown>): string {
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.audio === 'string') return event.audio;
  return '';
}

export function sanitizeVoiceError(message: string): string {
  if (/key|unauthorized|forbidden|invalid api/i.test(message)) {
    return 'Voice authentication failed. Check XAI_API_KEY.';
  }
  return message.slice(0, 240);
}

/** Map one xAI realtime server event onto browser messages. Pure — covered by unit tests. */
export function mapGrokServerEvent(event: Record<string, unknown>, assistantTranscript: string): MappedVoiceEvent {
  const type = typeof event.type === 'string' ? event.type : '';
  const keep = { assistantTranscript, toClient: [] as Array<Record<string, unknown>> };

  switch (type) {
    case 'session.updated':
      return { ...keep, ready: true, toClient: [{ type: 'ready' }] };
    case 'response.output_audio.delta':
    case 'response.audio.delta': {
      const audio = audioDelta(event);
      if (!audio) return keep;
      return { ...keep, toClient: [{ type: 'audio', audio }] };
    }
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta': {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      const text = assistantTranscript + delta;
      return { assistantTranscript: text, toClient: [{ type: 'transcript', who: 'ai', text, partial: true }] };
    }
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done': {
      const text = typeof event.transcript === 'string' ? event.transcript : assistantTranscript;
      return { assistantTranscript: '', toClient: [{ type: 'transcript', who: 'ai', text, partial: false }] };
    }
    case 'conversation.item.input_audio_transcription.updated':
    case 'conversation.item.input_audio_transcription.completed': {
      const text = typeof event.transcript === 'string' ? event.transcript : '';
      if (!text) return keep;
      const partial = type.endsWith('.updated');
      return { ...keep, toClient: [{ type: 'transcript', who: 'user', text, partial }] };
    }
    case 'input_audio_buffer.speech_started':
      return { assistantTranscript: '', toClient: [{ type: 'interrupted' }] };
    case 'response.done':
      return { ...keep, toClient: [{ type: 'turnComplete' }] };
    case 'response.function_call_arguments.done':
      return {
        ...keep,
        functionCall: {
          name: typeof event.name === 'string' ? event.name : '',
          callId: typeof event.call_id === 'string' ? event.call_id : '',
          arguments: typeof event.arguments === 'string' ? event.arguments : JSON.stringify(event.arguments ?? {}),
        },
      };
    case 'error': {
      const nested = event.error as { message?: unknown } | undefined;
      const message = typeof event.message === 'string'
        ? event.message
        : typeof nested?.message === 'string'
          ? nested.message
          : 'Voice session error';
      return { ...keep, toClient: [{ type: 'error', message: sanitizeVoiceError(message) }] };
    }
    default:
      return keep;
  }
}

function sessionUpdate(voice: string, reasoning: 'high' | 'none'): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      voice,
      instructions: VOICE_SYSTEM,
      turn_detection: { type: 'server_vad' },
      reasoning: { effort: reasoning },
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 16000 },
          transcription: { model: 'grok-transcribe' },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
      tools: GROK_VOICE_TOOLS,
    },
  });
}

export function attachGrokVoice(server: Server, env: NodeJS.ProcessEnv = process.env): void {
  const key = xaiKey(env);
  if (!key) {
    console.log('[voice] grok selected but XAI_API_KEY is missing');
    return;
  }
  const model = grokVoiceModel(env);
  const voice = grokVoiceName(env);
  const reasoning = grokVoiceReasoning(env);
  const generator = getGenerator(env);
  const wss = new WebSocketServer({ server, path: '/voice' });
  console.log(`[voice] Grok speech-to-speech ready at /voice (model ${model}, voice ${voice}, generator ${generator.name})`);

  wss.on('connection', (browser) => {
    let live: WebSocket | null = null;
    let spec: UISpec = { tree: [] };
    let readable = '';
    let closing = false;
    let reconnects = 0;
    let connecting = false;
    let assistantTranscript = '';
    let announcedReady = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let toolInflight = 0;
    let toolTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingReads = new Map<string, (value: string | null) => void>();

    const sendBrowser = (payload: unknown) => {
      try { browser.send(JSON.stringify(payload)); } catch { /* closed */ }
    };

    const requestRead = (): Promise<string | null> => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { pendingReads.delete(id); resolve(null); }, 2500);
      pendingReads.set(id, (value) => { clearTimeout(timer); resolve(value); });
      sendBrowser({ type: 'readRequest', id });
    });

    const continueAfterTools = () => {
      if (toolTimer) clearTimeout(toolTimer);
      toolTimer = setTimeout(() => {
        toolTimer = null;
        if (toolInflight === 0 && live?.readyState === WebSocket.OPEN) {
          live.send(JSON.stringify({ type: 'response.create' }));
        }
      }, 40);
    };

    const handleFunction = async (call: { name: string; callId: string; arguments: string }) => {
      toolInflight += 1;
      if (toolTimer) { clearTimeout(toolTimer); toolTimer = null; }
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.arguments || '{}') as unknown;
        args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        args = {};
      }
      sendBrowser({ type: 'tool', name: call.name, args });
      try {
        const outcome = await runVoiceTool(call.name, args, { generator, spec, readable, requestRead });
        if (outcome.spec) {
          spec = outcome.spec;
          sendBrowser({ type: 'spec', spec });
        }
        live?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(outcome.result),
          },
        }));
      } catch (err) {
        console.error('[voice] tool failed:', (err as Error).message);
      } finally {
        toolInflight -= 1;
        if (toolInflight === 0) continueAfterTools();
      }
    };

    const connectLive = () => {
      if (connecting || closing) return;
      connecting = true;
      announcedReady = false;
      const upstream = new WebSocket(xaiRealtimeURL(model, env), {
        headers: { Authorization: `Bearer ${key}` },
      });
      live = upstream;

      const release = () => { connecting = false; };

      upstream.on('open', () => {
        release();
        upstream.send(sessionUpdate(voice, reasoning));
      });

      upstream.on('message', (data, isBinary) => {
        if (isBinary) return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data.toString()) as Record<string, unknown>; } catch { return; }
        const eventType = typeof event.type === 'string' ? event.type : '';
        if (eventType.startsWith('session.') || eventType === 'error') console.log(`[voice] ${eventType}`);
        const mapped = mapGrokServerEvent(event, assistantTranscript);
        assistantTranscript = mapped.assistantTranscript;
        for (const message of mapped.toClient) {
          if (message.type === 'ready') {
            if (!announcedReady) {
              announcedReady = true;
              reconnects = 0;
              if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
              sendBrowser({ type: 'ready' });
            }
            continue;
          }
          sendBrowser(message);
        }
        if (mapped.functionCall) {
          handleFunction(mapped.functionCall).catch((err) => {
            console.error('[voice] tool failed:', (err as Error).message);
          });
        }
      });

      upstream.on('error', (err) => {
        const message = (err as Error).message || 'Voice connection failed';
        console.error('[voice] upstream:', message);
        if (/401|403|unauthorized/i.test(message)) {
          closing = true;
          sendBrowser({ type: 'error', message: sanitizeVoiceError(message) });
        }
      });

      upstream.on('close', () => {
        release();
        if (live !== upstream) return;
        live = null;
        if (closing || browser.readyState !== WebSocket.OPEN) return;
        if (reconnects < 3) {
          reconnects += 1;
          setTimeout(connectLive, 300);
        } else {
          sendBrowser({ type: 'error', message: 'Voice session ended — reconnect to start again.' });
        }
      });
    };

    browser.on('message', (buf) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(buf.toString()) as Record<string, unknown>; } catch { return; }
      try {
        if (message.type === 'init') {
          spec = (message.spec as UISpec) ?? { tree: [] };
          readable = typeof message.readable === 'string' ? message.readable : '';
          if (!live) {
            connectLive();
            if (readyTimer) clearTimeout(readyTimer);
            readyTimer = setTimeout(() => {
              if (!announcedReady && !closing) {
                sendBrowser({ type: 'error', message: 'Voice session did not become ready.' });
              }
            }, 8000);
          }
        } else if (message.type === 'context') {
          if (message.spec) spec = message.spec as UISpec;
          if (typeof message.readable === 'string') readable = message.readable;
        } else if (message.type === 'readResponse') {
          const id = typeof message.id === 'string' ? message.id : '';
          const cb = pendingReads.get(id);
          if (cb) {
            pendingReads.delete(id);
            cb(typeof message.readable === 'string' ? message.readable : null);
          }
        } else if (message.type === 'audio' && live?.readyState === WebSocket.OPEN && typeof message.audio === 'string') {
          live.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: message.audio }));
        } else if (message.type === 'text' && live?.readyState === WebSocket.OPEN && typeof message.text === 'string') {
          live.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: message.text }],
            },
          }));
          live.send(JSON.stringify({ type: 'response.create' }));
        }
      } catch (err) {
        sendBrowser({ type: 'error', message: sanitizeVoiceError((err as Error).message) });
      }
    });

    const cleanup = () => {
      closing = true;
      if (toolTimer) clearTimeout(toolTimer);
      if (readyTimer) clearTimeout(readyTimer);
      for (const cb of pendingReads.values()) cb(null);
      pendingReads.clear();
      try { live?.close(); } catch { /* noop */ }
    };
    browser.on('close', cleanup);
    browser.on('error', cleanup);
  });
}
