/**
 * Generation layer. The rest of the app talks to the `Generator` interface.
 * Default provider is Grok (`XAI_API_KEY`). `GENERATOR=gemini` keeps the
 * previous Gemini path. With no key, the stub serves a connect-a-model notice.
 */
import { geminiKey, generatorChoice, xaiKey } from './config.ts';
import { GeminiGenerator } from './gemini.ts';
import { GrokGenerator } from './grok.ts';
import { echoSpec } from './spec-build.ts';
import type { Generator } from './types.ts';
import type { UISpec } from '../shared/spec.ts';

export type { Generator, GeneratorName } from './types.ts';
export { echoSpec, isDegradedSpec, namespaceScreen } from './spec-build.ts';

export class StubGenerator implements Generator {
  readonly name = 'stub' as const;
  readonly model = null;

  async generate(prompt: string): Promise<UISpec> {
    return echoSpec(prompt, 'No model connected');
  }

  /** The offline stub can't reason about edits — it returns the spec unchanged. */
  async refine(_prompt: string, spec: UISpec): Promise<UISpec> {
    return spec;
  }

  async generateApp(prompt: string): Promise<UISpec> {
    return this.generate(prompt);
  }
}

export function getGenerator(env: NodeJS.ProcessEnv = process.env): Generator {
  const choice = generatorChoice(env);
  if (choice === 'stub') return new StubGenerator();

  if (choice === 'gemini') {
    if (!geminiKey(env)) {
      console.warn('[generator] GENERATOR=gemini but no GEMINI_API_KEY or GOOGLE_API_KEY — using stub');
      return new StubGenerator();
    }
    try {
      return new GeminiGenerator(env);
    } catch (err) {
      console.warn('[generator] gemini unavailable, falling back to stub:', (err as Error).message);
      return new StubGenerator();
    }
  }

  if (choice === 'grok') {
    if (!xaiKey(env)) {
      console.warn('[generator] GENERATOR=grok but XAI_API_KEY is not set — using stub');
      return new StubGenerator();
    }
    try {
      return new GrokGenerator(env);
    } catch (err) {
      console.warn('[generator] grok unavailable, falling back to stub:', (err as Error).message);
      return new StubGenerator();
    }
  }

  const unexpected: never = choice;
  void unexpected;
  return new StubGenerator();
}
