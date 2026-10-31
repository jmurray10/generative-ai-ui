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
import type { GenerateOptions, Generator } from './types.ts';
import { designInstructions } from './design-systems.ts';
import { grokModel, grokReasoningEffort, xaiBaseURL, xaiKey, type ReasoningEffort } from './config.ts';
import { buildAppFromPlan, echoSpec, isDegradedSpec } from './spec-build.ts';

const UI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
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
  required: ['title', 'tree'],
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

  private async complete(user: string, schemaName: string, schema: Record<string, unknown>, maxTokens: number, instructions?: string): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions,
      input: user,
      max_output_tokens: maxTokens,
      prompt_cache_key: 'genui-playground',
      reasoning: { effort: this.effort },
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema,
          strict: false,
        },
      },
    });
    return responseText(response);
  }

  private async specFrom(user: string, logLabel: string, opts?: GenerateOptions): Promise<UISpec> {
    let text = '';
    try {
      const instructions = SYSTEM_PROMPT + designInstructions(opts?.designSystem, opts?.lane);
      text = await this.complete(user, 'ui_spec', UI_SCHEMA, 16384, instructions);
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const extracted = inspectJSON(text);
      if (extracted.warnings.length) console.warn(`[grok] ${logLabel}:`, extracted.warnings);
      const parsed = JSON.parse(extracted.json);
      const { spec, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[grok] ${logLabel}: ${warnings.length} spec warning(s):`, warnings);
      return spec;
    } catch (err) {
      console.error(`[grok] ${logLabel} failed:`, (err as Error).message);
      if (text) console.error('[grok] raw (first 500):', text.slice(0, 500));
      return echoSpec(user.replace(/^Build:\s*/, '').slice(0, 500), "Couldn't build that one");
    }
  }

  async generate(prompt: string, opts?: GenerateOptions): Promise<UISpec> {
    return this.specFrom(`Build: ${prompt}`, 'generate', opts);
  }

  async refine(prompt: string, spec: UISpec): Promise<UISpec> {
    const next = await this.specFrom(
      `Current UI spec (JSON):\n${JSON.stringify(spec)}\n\nApply this change and return the COMPLETE updated spec: ${prompt}`,
      'refine',
    );
    return isDegradedSpec(next) ? spec : next;
  }

  async generateApp(prompt: string): Promise<UISpec> {
    try {
      const planText = await this.complete(
        'Plan a multi-screen interface for this request. Return JSON with a title and 2 to 5 screens. ' +
          'Each screen prompt is a complete, self-contained instruction to build that ONE screen. Request: ' +
          prompt,
        'ui_plan',
        PLAN_SCHEMA,
        2048,
      );
      const extractedPlan = inspectJSON(planText);
      if (extractedPlan.warnings.length) console.warn('[grok] plan:', extractedPlan.warnings);
      const plan = JSON.parse(extractedPlan.json);
      return await buildAppFromPlan(plan, prompt, (screen) => this.generate(screen));
    } catch (err) {
      console.error('[grok] generateApp failed:', (err as Error).message);
      return this.generate(prompt);
    }
  }
}
