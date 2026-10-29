/**
 * Voice entrypoint. Default is Grok speech-to-speech when XAI_API_KEY is set.
 * VOICE_PROVIDER=gemini keeps Gemini Live. With neither key, /voice answers
 * once with an error so the panel does not sit on "connecting".
 */
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { geminiLiveModel, geminiLiveVoice, grokVoiceModel, grokVoiceName, voiceChoice, type VoiceChoice } from './config.ts';
import { attachGeminiVoice } from './voice-gemini.ts';
import { attachGrokVoice } from './voice-grok.ts';

export interface VoiceInfo {
  provider: VoiceChoice;
  model: string | null;
  voice: string | null;
}

export function voiceInfo(env: NodeJS.ProcessEnv = process.env): VoiceInfo {
  const provider = voiceChoice(env);
  if (provider === 'grok') return { provider, model: grokVoiceModel(env), voice: grokVoiceName(env) };
  if (provider === 'gemini') return { provider, model: geminiLiveModel(env), voice: geminiLiveVoice(env) };
  return { provider: 'off', model: null, voice: null };
}

export function attachVoice(server: Server, env: NodeJS.ProcessEnv = process.env): void {
  const provider = voiceChoice(env);
  if (provider === 'grok') {
    attachGrokVoice(server, env);
    return;
  }
  if (provider === 'gemini') {
    attachGeminiVoice(server, env);
    return;
  }
  const wss = new WebSocketServer({ server, path: '/voice' });
  console.log('[voice] disabled — set XAI_API_KEY for Grok voice, or VOICE_PROVIDER=gemini with a Gemini key');
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Voice is off. Set XAI_API_KEY for Grok voice, or VOICE_PROVIDER=gemini with a Gemini key.',
    }));
  });
}
