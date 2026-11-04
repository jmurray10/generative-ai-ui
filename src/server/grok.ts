/**
 * Live generation via the xAI Responses API (`POST /v1/responses`).
 * The OpenAI SDK points at `https://api.x.ai/v1` — the path the Grok 4.7
 * guide documents. grok-4.7 is the current flagship text model.
 *
 * UISpec trees are recursive, and the Responses structured-output engine
 * rejects circular `$ref`s, so the schema describes the top of the tree and
 * leaves nested nodes open. `validateSpec` still repairs the payload.
 */
import OpenAI from 'openai';
import type { UISpec } from '../shared/spec.ts';
import { inspectJSON } from './json.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { validateSpec } from './validate.ts';
import type { GenerateHooks, GenerateOptions, Generator } from './types.ts';
import { routeHints } from './route-hints.ts';
import { SpecScanner } from './spec-progress.ts';
import { logger, since } from './log.ts';

const log = logger('grok');
import { grokModel, grokReasoningEffort, xaiBaseURL, xaiKey, type ReasoningEffort } from './config.ts';
import { buildAppFromPlan, echoSpec, isDegradedSpec } from './spec-build.ts';

const UI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    // First, so the model commits to a design brief before it writes the UI.
    design: {
      type: 'object',
      properties: {
        direction: { type: 'string' },
        fonts: { type: 'string' },
        palette: { type: 'array', items: { type: 'string' } },
        signature: { type: 'string' },
      },
      required: ['direction', 'fonts', 'palette', 'signature'],
      additionalProperties: false,
    },
    title: { type: 'string' },
    initialState: { type: 'object', additionalProperties: true },
    theme: {
      type: 'object',
      properties: {
        bg: { type: 'string' },
        surface: { type: 'string' },
        text: { type: 'string' },
        muted: { type: 'string' },
        accent: { type: 'string' },
        border: { type: 'string' },
        font: { type: 'string' },
      },
      additionalProperties: false,
    },
    tree: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          props: { type: 'object', additionalProperties: true },
          bind: { type: 'object', additionalProperties: { type: 'string' } },
          children: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        required: ['id', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['design', 'title', 'tree'],
  additionalProperties: false,
};

const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    screens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['title', 'prompt'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'screens'],
  additionalProperties: false,
};

export function responseText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('');
}

export class GrokGenerator implements Generator {
  readonly name = 'grok' as const;
  readonly model: string;
  private client: OpenAI;
  private effort: ReasoningEffort;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = xaiKey(env);
    if (!key) throw new Error('XAI_API_KEY is required for the grok generator.');
    this.client = new OpenAI({ apiKey: key, baseURL: xaiBaseURL(env) });
    this.model = grokModel(env);
    this.effort = grokReasoningEffort(env);
  }

  /**
   * One structured-output call, streamed. Deltas feed `onDelta` (live build
   * progress); usage and timing are logged when the response completes.
   */
  private async complete(
    user: string,
    schemaName: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    instructions?: string,
    hooks: GenerateHooks & { onDelta?: (chunk: string) => void } = {},
  ): Promise<string> {
    const t0 = Date.now();
    const stream = await this.client.responses.create({
      model: this.model,
      instructions,
      input: user,
      max_output_tokens: maxTokens,
      prompt_cache_key: 'genui-playground',
      reasoning: { effort: this.effort },
      text: { format: { type: 'json_schema', name: schemaName, schema, strict: false } },
      stream: true,
    });
    let text = '';
    let firstTokenMs: number | undefined;
    for await (const ev of stream) {
      if (ev.type === 'response.output_text.delta') {
        firstTokenMs ??= since(t0);
        text += ev.delta;
        hooks.onDelta?.(ev.delta);
      } else if (ev.type === 'response.completed') {
        if (!text.trim()) text = responseText(ev.response);
        const u = ev.response.usage;
        log.info('model call', {
          rid: hooks.rid,
          call: schemaName,
          model: this.model,
          ms: since(t0),
          firstTokenMs,
          inTok: u?.input_tokens,
          cachedTok: u?.input_tokens_details?.cached_tokens,
          outTok: u?.output_tokens,
          reasoningTok: u?.output_tokens_details?.reasoning_tokens,
          chars: text.length,
        });
      } else if (ev.type === 'response.failed' || ev.type === 'response.incomplete') {
        const reason = ev.type === 'response.incomplete' ? ev.response.incomplete_details?.reason : ev.response.error?.message;
        log.warn('model call ended early', { rid: hooks.rid, call: schemaName, type: ev.type, reason, ms: since(t0), chars: text.length });
        if (ev.type === 'response.failed') throw new Error(reason || 'model call failed');
      } else if (ev.type === 'error') {
        throw new Error(ev.message || 'model stream error');
      }
    }
    return text;
  }

  private async specFrom(user: string, logLabel: string, hooks: GenerateHooks = {}): Promise<UISpec> {
    let text = '';
    const scanner = new SpecScanner();
    const emit = hooks.onProgress;
    emit?.(scanner.snapshot());
    try {
      text = await this.complete(user, 'ui_spec', UI_SCHEMA, 16384, SYSTEM_PROMPT, {
        rid: hooks.rid,
        onDelta: emit ? (chunk) => scanner.push(chunk).forEach(emit) : undefined,
      });
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const extracted = inspectJSON(text);
      if (extracted.warnings.length) log.warn(`${logLabel}: extraction`, { rid: hooks.rid, warnings: extracted.warnings });
      const parsed = JSON.parse(extracted.json);
      const { spec, warnings } = validateSpec(parsed);
      if (warnings.length) log.warn(`${logLabel}: spec repaired`, { rid: hooks.rid, count: warnings.length, warnings: warnings.slice(0, 5) });
      return spec;
    } catch (err) {
      log.error(`${logLabel} failed`, { rid: hooks.rid, err: (err as Error).message, raw: text ? text.slice(0, 300) : undefined });
      return echoSpec(user.replace(/^Build:\s*/, '').replace(/\n\nROUTING[\s\S]*$/, '').slice(0, 500), "Couldn't build that one");
    }
  }

  async generate(prompt: string, opts?: GenerateOptions, hooks?: GenerateHooks): Promise<UISpec> {
    return this.specFrom(`Build: ${prompt}${routeHints(opts)}`, 'generate', hooks);
  }

  async refine(prompt: string, spec: UISpec, hooks?: GenerateHooks): Promise<UISpec> {
    const next = await this.specFrom(
      `Current UI spec (JSON):\n${JSON.stringify(spec)}\n\nApply this change and return the COMPLETE updated spec: ${prompt}`,
      'refine',
      hooks,
    );
    return isDegradedSpec(next) ? spec : next;
  }

  async generateApp(prompt: string, hooks: GenerateHooks = {}): Promise<UISpec> {
    try {
      hooks.onProgress?.({ phase: 'planning', chars: 0, parts: 0 });
      const planText = await this.complete(
        'Plan a multi-screen interface for this request. Return JSON with a title and 2 to 5 screens. ' +
          'Each screen prompt is a complete, self-contained instruction to build that ONE screen. Request: ' +
          prompt,
        'ui_plan',
        PLAN_SCHEMA,
        2048,
        undefined,
        { rid: hooks.rid },
      );
      const extractedPlan = inspectJSON(planText);
      if (extractedPlan.warnings.length) log.warn('plan: extraction', { rid: hooks.rid, warnings: extractedPlan.warnings });
      const plan = JSON.parse(extractedPlan.json);
      let done = 0;
      hooks.onProgress?.({ phase: 'building', chars: 0, parts: 0, title: typeof plan?.title === 'string' ? plan.title : undefined });
      // Screens generate in parallel, so progress is per finished screen, not per token.
      return await buildAppFromPlan(plan, prompt, async (screen) => {
        const spec = await this.generate(screen, undefined, { rid: hooks.rid });
        hooks.onProgress?.({ phase: 'building', chars: 0, parts: ++done, part: { type: 'Screen', label: spec.title ?? screen.split(':')[0] } });
        return spec;
      });
    } catch (err) {
      log.error('generateApp failed', { rid: hooks.rid, err: (err as Error).message });
      return this.generate(prompt, undefined, hooks);
    }
  }
}
