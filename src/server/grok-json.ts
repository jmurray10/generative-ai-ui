/** One structured-output call to grok-4.7 (Responses API). Shared by the showcase endpoints. */
import OpenAI from 'openai';
import { grokModel, grokReasoningEffort, xaiBaseURL, xaiKey } from './config.ts';
import { responseText } from './grok.ts';
import { inspectJSON } from './json.ts';

let client: OpenAI | null = null;
function getClient(env: NodeJS.ProcessEnv): OpenAI {
  const key = xaiKey(env);
  if (!key) throw new Error('XAI_API_KEY is not set');
  client ??= new OpenAI({ apiKey: key, baseURL: xaiBaseURL(env) });
  return client;
}

export interface GrokJSONOptions {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  env?: NodeJS.ProcessEnv;
}

export async function grokJSON<T>(opts: GrokJSONOptions): Promise<T> {
  const env = opts.env ?? process.env;
  const response = await getClient(env).responses.create({
    model: grokModel(env),
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: opts.maxTokens ?? 4096,
    reasoning: { effort: grokReasoningEffort(env) },
    text: { format: { type: 'json_schema', name: opts.schemaName, schema: opts.schema, strict: false } },
  });
  const text = responseText(response);
  if (!text.trim()) throw new Error('Grok returned an empty response');
  return JSON.parse(inspectJSON(text).json) as T;
}

export function grokModelName(env: NodeJS.ProcessEnv = process.env): string {
  return grokModel(env);
}
