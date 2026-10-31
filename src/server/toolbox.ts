/**
 * decideToolbox(prompt) -> DecisionEnvelope: the single seam every showcase
 * goes through to pick its tools. Backends: Jev (TypeSafe) when configured,
 * else a Grok-backed judge answering the same questions. The policy is code.
 *
 * Fail closed: when the chosen backend errors, the decision is a hold. A
 * configured Jev that fails does NOT silently fall back to Grok.
 */
import type { DecisionEnvelope, DecisionSource } from '../shared/toolbox.ts';
import { deciderChoice } from './config.ts';
import { askJev } from './jev/client.ts';
import { askGrokJudge } from './jev/grok-judge.ts';
import { explain, routeToolbox, type Answers } from './jev/policy.ts';

export type Judge = (prompt: string) => Promise<{ answers: Answers; model: string }>;

export interface DeciderDeps {
  source: DecisionSource;
  judge: Judge | null;
}

export function deciderFromEnv(env: NodeJS.ProcessEnv = process.env): DeciderDeps {
  const choice = deciderChoice(env);
  if (choice === 'jev') return { source: 'jev', judge: (p) => askJev(p, env) };
  if (choice === 'grok') return { source: 'grok_fallback', judge: askGrokJudge };
  return { source: 'none', judge: null };
}

export async function decideToolbox(prompt: string, deps: DeciderDeps = deciderFromEnv()): Promise<DecisionEnvelope> {
  const t0 = Date.now();
  if (!deps.judge) {
    const decision = routeToolbox(null, new Error('no decision backend'));
    return { prompt, decision, source: 'none', model: null, ms: 0, why: [...explain(decision), 'No decision backend is configured (set TYPESAFE_API_KEY or XAI_API_KEY).'], error: 'no decision backend configured' };
  }
  try {
    const { answers, model } = await deps.judge(prompt);
    const decision = routeToolbox(answers);
    return { prompt, decision, source: deps.source, model, ms: Date.now() - t0, why: explain(decision) };
  } catch (err) {
    const decision = routeToolbox(null, err);
    const message = String((err as Error)?.message ?? err).slice(0, 160);
    return { prompt, decision, source: deps.source, model: null, ms: Date.now() - t0, why: [...explain(decision), `Backend error: ${message}`], error: message };
  }
}
