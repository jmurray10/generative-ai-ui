/**
 * The toolbox decision: which pieces of the UI toolbox a prompt gets.
 *
 * The union below mirrors the Jev router spec exactly, so a Jev-backed decider
 * and the Grok-backed fallback return the same shape. Code owns the policy
 * (src/server/jev/policy.ts); a decider only supplies typed judgments.
 */

export type DesignSystem = 'editorial_serif' | 'ops_console' | 'soft_consumer';
export type RenderMode = 'registry' | 'sandboxed_react';
export type ToolboxComponent = 'stepper' | 'table' | 'drawer' | 'citation_viewer' | 'approval_card';
export type Check = 'impeccable_loop' | 'axe_core' | 'empty_loading_error_states' | 'couldnt_verify_state';
export type MissingSlot = 'audience' | 'data_source' | 'primary_action';
export type HoldReason = 'unsafe_or_injection' | 'low_confidence' | 'jev_error' | 'contradictory';

export type Decision =
  | {
      kind: 'route';
      designSystem: DesignSystem;
      renderMode: RenderMode;
      components: ToolboxComponent[];
      checks: Check[];
      evidence: Record<string, number>;
    }
  | { kind: 'ask'; slot: MissingSlot; prompt: string; evidence: Record<string, number> }
  | { kind: 'hold'; reason: HoldReason; evidence: Record<string, number> };

/** Which backend produced the judgments the policy ran on. */
export type DecisionSource = 'jev' | 'grok_fallback' | 'none';

/** What /api/decide returns: the decision plus the "why these tools" log. */
export interface DecisionEnvelope {
  prompt: string;
  decision: Decision;
  source: DecisionSource;
  model: string | null;
  ms: number;
  /** Plain-language lines, written by code from the evidence, for the panel and voice. */
  why: string[];
  /** Set when the backend failed (the decision is then a hold). Never contains secrets. */
  error?: string;
}

export const DESIGN_SYSTEMS: { id: DesignSystem; dir: string; label: string }[] = [
  { id: 'editorial_serif', dir: 'editorial-serif', label: 'Editorial serif' },
  { id: 'ops_console', dir: 'ops-console', label: 'Dense ops console' },
  { id: 'soft_consumer', dir: 'soft-consumer', label: 'Soft consumer' },
];

export function isDesignSystem(v: unknown): v is DesignSystem {
  return typeof v === 'string' && DESIGN_SYSTEMS.some((d) => d.id === v);
}
