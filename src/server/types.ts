import type { UISpec } from '../shared/spec.ts';
import type { GenerateOptions } from './route-hints.ts';
import type { BuildProgress } from './spec-progress.ts';

export type { GenerateOptions };

export type GeneratorName = 'stub' | 'grok' | 'gemini';

/** Per-call hooks: live progress for the UI and a request id for the logs. */
export interface GenerateHooks {
  onProgress?: (p: BuildProgress) => void;
  rid?: string;
}

export interface Generator {
  readonly name: GeneratorName;
  /** Concrete model id, or null for the offline stub. */
  readonly model: string | null;
  generate(prompt: string, opts?: GenerateOptions, hooks?: GenerateHooks): Promise<UISpec>;
  /** Apply a natural-language change to an existing spec, returning the full updated spec. */
  refine(prompt: string, spec: UISpec, hooks?: GenerateHooks): Promise<UISpec>;
  /** Multi-screen apps: plan screens, generate each independently, assemble into Tabs. */
  generateApp(prompt: string, hooks?: GenerateHooks): Promise<UISpec>;
}