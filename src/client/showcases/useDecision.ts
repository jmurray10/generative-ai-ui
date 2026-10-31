import { useCallback, useRef, useState } from 'react';
import type { DecisionEnvelope, DesignSystem, MissingSlot } from '../../shared/toolbox';
import { postJSON } from './sse';

const SLOT_LABEL: Record<MissingSlot, string> = { audience: 'Audience', data_source: 'Data', primary_action: 'Main action' };

export type DecisionState =
  | { status: 'idle' }
  | { status: 'loading'; prompt: string }
  | { status: 'error'; prompt: string; error: string }
  | { status: 'done'; envelope: DecisionEnvelope; overridden: boolean };

/**
 * Drives decideToolbox from the client. An "ask" answer is appended to the
 * prompt and re-decided once with answered=true, so the policy routes or holds
 * and never asks again. Only a low_confidence hold can be overridden by the
 * person; safety holds and backend errors cannot.
 */
export function useDecision() {
  const [state, setState] = useState<DecisionState>({ status: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);

  const decide = useCallback(async (prompt: string, answered = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ status: 'loading', prompt });
    try {
      const envelope = await postJSON<DecisionEnvelope>('/api/decide', { prompt, answered }, ctrl.signal);
      if (!ctrl.signal.aborted) setState({ status: 'done', envelope, overridden: false });
    } catch (err) {
      if (!ctrl.signal.aborted) setState({ status: 'error', prompt, error: (err as Error).message });
    }
  }, []);

  const answer = useCallback((text: string) => {
    const s = stateRef.current;
    if (s.status !== 'done' || s.envelope.decision.kind !== 'ask') return;
    void decide(`${s.envelope.prompt}\n${SLOT_LABEL[s.envelope.decision.slot]}: ${text.trim()}`, true);
  }, [decide]);

  const override = useCallback(() => {
    setState((s) => (s.status === 'done' && s.envelope.decision.kind === 'hold' && s.envelope.decision.reason === 'low_confidence' ? { ...s, overridden: true } : s));
  }, []);

  return { state, decide, answer, override };
}

/** Can the showcase build? Route, or a low-confidence hold the person overrode. */
export function canBuild(s: DecisionState): boolean {
  return s.status === 'done' && (s.envelope.decision.kind === 'route' || s.overridden);
}

/** The design system the showcase should render in, with a per-page default before (or without) a route. */
export function designFor(s: DecisionState, fallback: DesignSystem): DesignSystem {
  return s.status === 'done' && s.envelope.decision.kind === 'route' ? s.envelope.decision.designSystem : fallback;
}
