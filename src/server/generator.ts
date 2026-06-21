/**
 * Generation layer. The rest of the app talks to the `Generator` interface, so
 * swapping the offline stub for a real LLM is a one-line change in `getGenerator`.
 */
import { GoogleGenAI } from '@google/genai';
import type { UISpec } from '../shared/spec.ts';
import { findExample } from './examples.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { validateSpec } from './validate.ts';

export interface Generator {
  readonly name: 'stub' | 'gemini';
  generate(prompt: string): Promise<UISpec>;
  /** Apply a natural-language change to an existing spec, returning the full updated spec. */
  refine(prompt: string, spec: UISpec): Promise<UISpec>;
}

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

/**
 * Offline generator: keyword-matches the prompt to a pre-baked example, or
 * falls back to an "echo" card that explains what a live model would build.
 * Lets the whole playground run with zero configuration.
 */
export class StubGenerator implements Generator {
  readonly name = 'stub' as const;

  async generate(prompt: string): Promise<UISpec> {
    const match = findExample(prompt);
    if (match) return match.spec;
    return echoSpec(prompt, 'No live model connected');
  }

  /** The offline stub can't reason about edits — it returns the spec unchanged. */
  async refine(_prompt: string, spec: UISpec): Promise<UISpec> {
    return spec;
  }
}

/** Live generation via Gemini (new @google/genai SDK). */
export class GeminiGenerator implements Generator {
  readonly name = 'gemini' as const;
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const key = apiKey();
    if (!key) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required for the gemini generator.');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async generate(prompt: string): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: `Build: ${prompt}` }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      });
      text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('Model returned an empty response.');

      const parsed = JSON.parse(extractJSON(text));
      const { spec, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini] ${warnings.length} spec warning(s):`, warnings);
      return spec;
    } catch (err) {
      console.error('[gemini] generation failed:', (err as Error).message);
      if (text) console.error('[gemini] raw (first 500):', text.slice(0, 500));
      // Never hard-fail the demo: return a readable fallback card.
      return echoSpec(prompt, `Couldn't build that one — ${(err as Error).message}`);
    }
  }

  async refine(prompt: string, spec: UISpec): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Current UI spec (JSON):\n${JSON.stringify(spec)}\n\n` +
                  `Apply this change and return the COMPLETE updated spec: ${prompt}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      });
      text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const parsed = JSON.parse(extractJSON(text));
      const { spec: out, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini refine] ${warnings.length} warning(s):`, warnings);
      return out;
    } catch (err) {
      console.error('[gemini refine] failed:', (err as Error).message);
      return spec; // keep the current UI on failure
    }
  }
}

/** A friendly fallback spec shown when generation is unavailable or fails. */
function echoSpec(prompt: string, title: string): UISpec {
  return {
    title,
    tree: [
      {
        id: 'card',
        type: 'Card',
        props: { title, subtitle: 'Offline preview' },
        children: [
          {
            id: 'note',
            type: 'Text',
            props: {
              value:
                `You asked for: “${prompt}”.\n\n` +
                'Try one of the built-in examples — tip calculator, counter, or ' +
                'bouncing ball — which run fully offline.',
            },
          },
          { id: 'badge', type: 'Badge', props: { label: 'fallback', tone: 'muted' } },
        ],
      },
    ],
  };
}

/** Extract a JSON object/array from a model response that may have stray text. */
function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) return obj[0];
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) return arr[0];
  return text;
}

export function getGenerator(): Generator {
  if (process.env.GENERATOR === 'gemini' && apiKey()) {
    try {
      return new GeminiGenerator();
    } catch (err) {
      console.warn('[generator] gemini unavailable, falling back to stub:', (err as Error).message);
    }
  }
  return new StubGenerator();
}
