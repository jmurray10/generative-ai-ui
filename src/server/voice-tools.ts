/**
 * Tools the realtime voice agent can call against the on-screen UI.
 * Shared by the Grok speech-to-speech session and the opt-in Gemini Live session.
 */
import type { UISpec } from '../shared/spec.ts';
import type { Generator } from './types.ts';

export const VOICE_SYSTEM = `You are the voice assistant of a generative-UI playground. The user is looking at a UI a model just generated.
- To CHANGE what's on screen, call refine_ui (edits) or generate_ui (something new). Don't just describe it — call the tool, then briefly say what you did.
- Prefer refine_ui for changes to the CURRENT screen; only use generate_ui (a full replace) when the user clearly wants something entirely different.
- To READ the screen aloud or ANSWER a question about it, call read_ui first, then respond concisely from the real values it returns. read_ui always reflects the CURRENT screen, so after an edit you may call it again to confirm the new values.
- If a tool returns ok:false, do NOT claim success — briefly tell the user you couldn't apply that.
Keep spoken replies short and natural. Never invent data — only use what read_ui returns.`;

export interface VoiceToolContext {
  generator: Generator;
  spec: UISpec;
  readable: string;
  requestRead: () => Promise<string | null>;
}

export interface VoiceToolOutcome {
  result: Record<string, unknown>;
  spec?: UISpec;
}

export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: VoiceToolContext,
): Promise<VoiceToolOutcome> {
  try {
    if (name === 'read_ui') {
      const fresh = await ctx.requestRead();
      return { result: { text: (fresh ?? ctx.readable) || 'The screen is currently empty.' } };
    }
    if (ctx.generator.name === 'stub') {
      return { result: { ok: false, error: 'generation is unavailable — no model is connected' } };
    }
    if (name === 'generate_ui') {
      const spec = await ctx.generator.generate(String(args.prompt ?? ''));
      return { result: { ok: true, changed: true, title: spec.title ?? 'a new UI' }, spec };
    }
    if (name === 'refine_ui') {
      const before = JSON.stringify(ctx.spec);
      const spec = await ctx.generator.refine(String(args.instruction ?? ''), ctx.spec);
      const changed = JSON.stringify(spec) !== before;
      return changed
        ? { result: { ok: true, applied: String(args.instruction ?? '') }, spec }
        : { result: { ok: false, error: 'that change could not be applied — try rephrasing' } };
    }
  } catch (err) {
    return { result: { ok: false, error: (err as Error).message } };
  }
  return { result: { ok: false, error: 'unknown tool' } };
}

/** Grok realtime function tools (JSON Schema, lowercase types). */
export const GROK_VOICE_TOOLS = [
  {
    type: 'function' as const,
    name: 'read_ui',
    description:
      'Get the current on-screen UI text and data. Call this BEFORE reading the screen aloud or answering any question about what is shown, so you use real values.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function' as const,
    name: 'refine_ui',
    description:
      'Change the UI currently on screen. Use for any edit: "make it dark", "add a reset button", "change the tip to 25 percent", "turn the table into a bar chart". Do not just describe the change — call this tool.',
    parameters: {
      type: 'object',
      properties: { instruction: { type: 'string', description: 'the change to make' } },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    name: 'generate_ui',
    description: 'Replace the whole screen with a brand-new UI generated from a description (use when the user asks for something entirely different).',
    parameters: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
];
