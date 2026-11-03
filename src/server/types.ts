import type { UISpec } from '../shared/spec.ts';
import type { GenerateOptions } from './route-hints.ts';

export type { GenerateOptions };

export type GeneratorName = 'stub' | 'grok' | 'gemini';

export interface Generator {
  readonly name: GeneratorName;
  /** Concrete model id, or null for the offline stub. */
  readonly model: string | null;
  generate(prompt: string, opts?: GenerateOptions): Promise<UISpec>;
  /** Apply a natural-language change to an existing spec, returning the full updated spec. */
  refine(prompt: string, spec: UISpec): Promise<UISpec>;
  /** Multi-screen apps: plan screens, generate each independently, assemble into Tabs. */
  generateApp(prompt: string): Promise<UISpec>;
}
