/**
 * Opt-in Gemini generator. Used only when GENERATOR=gemini and a Gemini key
 * is set. The default path is Grok (`src/server/grok.ts`).
 */
import { GoogleGenAI } from '@google/genai';
import type { UISpec } from '../shared/spec.ts';
import { geminiKey, geminiModel } from './config.ts';
import { inspectJSON } from './json.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { buildAppFromPlan, echoSpec } from './spec-build.ts';
import type { Generator } from './types.ts';
import { validateSpec } from './validate.ts';

export class GeminiGenerator implements Generator {
  readonly name = 'gemini' as const;
  readonly model: string;
  private ai: GoogleGenAI;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = geminiKey(env);
    if (!key) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required for the gemini generator.');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = geminiModel(env);
  }

  private async complete(user: string, maxOutputTokens: number): Promise<{ text: string; finishReason?: string }> {
    const result = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    });
    const text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const finishReason = result.candidates?.[0]?.finishReason;
    return { text, finishReason: finishReason ? String(finishReason) : undefined };
  }

  async generate(prompt: string): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.complete(`Build: ${prompt}`, 16384);
      text = result.text;
      if (result.finishReason && result.finishReason !== 'STOP') {
        console.warn(`[gemini] finishReason=${result.finishReason} (output may be truncated or blocked)`);
      }
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const extracted = inspectJSON(text);
      if (extracted.warnings.length) console.warn('[gemini]', extracted.warnings);
      const parsed = JSON.parse(extracted.json);
      const { spec, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini] ${warnings.length} spec warning(s):`, warnings);
      return spec;
    } catch (err) {
      console.error('[gemini] generation failed:', (err as Error).message);
      if (text) console.error('[gemini] raw (first 500):', text.slice(0, 500));
      return echoSpec(prompt, "Couldn't build that one");
    }
  }

  async refine(prompt: string, spec: UISpec): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.complete(
        `Current UI spec (JSON):\n${JSON.stringify(spec)}\n\nApply this change and return the COMPLETE updated spec: ${prompt}`,
        16384,
      );
      text = result.text;
      if (result.finishReason && result.finishReason !== 'STOP') {
        console.warn(`[gemini] finishReason=${result.finishReason} (output may be truncated or blocked)`);
      }
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const extracted = inspectJSON(text);
      if (extracted.warnings.length) console.warn('[gemini refine]', extracted.warnings);
      const parsed = JSON.parse(extracted.json);
      const { spec: out, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini refine] ${warnings.length} warning(s):`, warnings);
      return out;
    } catch (err) {
      console.error('[gemini refine] failed:', (err as Error).message);
      return spec;
    }
  }

  async generateApp(prompt: string): Promise<UISpec> {
    try {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: [{
          role: 'user',
          parts: [{
            text:
              'Plan a multi-screen interface for this request. Return ONLY JSON: ' +
              '{"title": string, "screens": [{"title": string, "prompt": string}]} with 2 to 5 screens. ' +
              'Each "prompt" is a complete, self-contained instruction to build that ONE screen. Request: ' + prompt,
          }],
        }],
        config: { temperature: 0.5, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });
      const planText = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const extractedPlan = inspectJSON(planText);
      if (extractedPlan.warnings.length) console.warn('[gemini] plan:', extractedPlan.warnings);
      const plan = JSON.parse(extractedPlan.json);
      return await buildAppFromPlan(plan, prompt, (screen) => this.generate(screen));
    } catch (err) {
      console.error('[gemini generateApp] failed:', (err as Error).message);
      return this.generate(prompt);
    }
  }
}
