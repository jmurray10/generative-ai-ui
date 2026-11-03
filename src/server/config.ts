/** Env parsing for the generation and voice providers. Pure, so tests can pass a fake env. */

export type GeneratorChoice = 'stub' | 'grok' | 'gemini';
export type VoiceChoice = 'off' | 'grok' | 'gemini';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

const REASONING: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh']);

export function xaiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.XAI_API_KEY?.trim();
  return key || undefined;
}

export function geminiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY)?.trim();
  return key || undefined;
}

/** Default is Grok. `stub` is the offline notice. `gemini` is the opt-in fallback. */
export function generatorChoice(env: NodeJS.ProcessEnv = process.env): GeneratorChoice {
  const raw = (env.GENERATOR ?? 'grok').trim().toLowerCase();
  if (raw === 'stub' || raw === 'offline' || raw === 'none') return 'stub';
  if (raw === 'gemini' || raw === 'google') return 'gemini';
  if (raw === 'grok' || raw === 'xai') return 'grok';
  return 'stub';
}

/**
 * Default voice is Grok speech-to-speech when `XAI_API_KEY` is set.
 * Gemini Live is only used when `VOICE_PROVIDER=gemini` and a Gemini key exists.
 * There is a Grok equivalent for the realtime agent, so Gemini is not implied.
 */
export function voiceChoice(env: NodeJS.ProcessEnv = process.env): VoiceChoice {
  const raw = (env.VOICE_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'none' || raw === 'disabled') return 'off';
  if (raw === 'gemini' || raw === 'google') return geminiKey(env) ? 'gemini' : 'off';
  if (raw === 'grok' || raw === 'xai') return xaiKey(env) ? 'grok' : 'off';
  if (xaiKey(env)) return 'grok';
  return 'off';
}

export function grokModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROK_MODEL?.trim() || env.XAI_MODEL?.trim() || 'grok-4.7';
}

export function xaiBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  return (env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1').replace(/\/$/, '');
}

/** Text generation. `low` keeps the playground responsive; grok-4.7 defaults to `high`. */
export function grokReasoningEffort(env: NodeJS.ProcessEnv = process.env): ReasoningEffort {
  const raw = (env.GROK_REASONING_EFFORT ?? 'low').trim().toLowerCase();
  if (REASONING.has(raw)) return raw as ReasoningEffort;
  return 'low';
}

export function grokVoiceModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROK_VOICE_MODEL?.trim() || 'grok-voice-latest';
}

export function grokVoiceName(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROK_VOICE?.trim() || 'eve';
}

/** The realtime voice API accepts `high` or `none` (default in this app: `none`). */
export function grokVoiceReasoning(env: NodeJS.ProcessEnv = process.env): 'high' | 'none' {
  return (env.GROK_VOICE_REASONING ?? 'none').trim().toLowerCase() === 'high' ? 'high' : 'none';
}

export function geminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
}

export function geminiLiveModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.LIVE_API_MODEL?.trim() || 'gemini-2.5-flash-native-audio-preview-12-2025';
}

export function geminiLiveVoice(env: NodeJS.ProcessEnv = process.env): string {
  return env.LIVE_API_VOICE?.trim() || 'Kore';
}

/** Realtime WebSocket URL for the configured base (`https://api.x.ai/v1` → `wss://api.x.ai/v1/realtime`). */
export function xaiRealtimeURL(model: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = new URL(`${xaiBaseURL(env)}/`);
  const url = new URL('realtime', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('model', model);
  return url.toString();
}

/** TypeSafe (Jev) decision layer. Server-side only; the key never reaches the client. */
export function typesafeKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.TYPESAFE_API_KEY?.trim();
  return key || undefined;
}

export function typesafeBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TYPESAFE_BASE_URL?.trim() || 'https://api.typesafe.ai').replace(/\/$/, '');
}

export type DeciderChoice = 'jev' | 'grok' | 'none';

/**
 * `TOOLBOX_DECIDER=jev|grok|auto` (default auto). Auto uses Jev when
 * TYPESAFE_API_KEY is set, else the Grok-backed fallback, else none (hold).
 * An explicit `jev` with no key is `none`, so it holds instead of quietly using Grok.
 */
export function deciderChoice(env: NodeJS.ProcessEnv = process.env): DeciderChoice {
  const raw = (env.TOOLBOX_DECIDER ?? 'auto').trim().toLowerCase();
  if (raw === 'jev' || raw === 'typesafe') return typesafeKey(env) ? 'jev' : 'none';
  if (raw === 'grok') return xaiKey(env) ? 'grok' : 'none';
  if (typesafeKey(env)) return 'jev';
  if (xaiKey(env)) return 'grok';
  return 'none';
}
