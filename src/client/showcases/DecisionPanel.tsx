import React, { useState } from 'react';
import type { DecisionEnvelope } from '../../shared/toolbox';
import type { DecisionState } from './useDecision';

const SOURCE: Record<DecisionEnvelope['source'], string> = {
  jev: 'Jev (TypeSafe)',
  grok_fallback: 'Grok fallback (self-reported probabilities)',
  none: 'no decision backend',
};

const HOLD_TITLE: Record<string, string> = {
  jev_error: 'Held: decision layer error',
  unsafe_or_injection: 'Held: unsafe request',
  contradictory: 'Held: contradictory request',
  low_confidence: 'Held: not confident enough to build',
};

interface Props {
  state: DecisionState;
  onAnswer: (text: string) => void;
  onOverride: () => void;
  onRetry: () => void;
}

/** "Why these tools": the decision, its evidence-backed reasons, and the ask/hold paths. Voice reads it. */
export const DecisionPanel: React.FC<Props> = ({ state, onAnswer, onOverride, onRetry }) => {
  const [reply, setReply] = useState('');
  return (
    <section aria-labelledby="why-tools" data-voice-surface="Why these tools" className="border border-edge bg-panel p-3 text-sm">
      <h2 id="why-tools" className="font-display text-xs font-semibold uppercase tracking-wider text-muted">Why these tools</h2>
      {state.status === 'idle' && <p className="mt-2 text-muted">No decision yet. Run the decision to pick the tools for this prompt.</p>}
      {state.status === 'loading' && <p className="mt-2 text-muted" role="status">Deciding which tools to use…</p>}
      {state.status === 'error' && (
        <div className="mt-2" role="alert">
          <p className="text-ink">The decision request failed: {state.error}. Nothing was built.</p>
          <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-edge px-3 py-1 text-ink hover:border-accent">Retry decision</button>
        </div>
      )}
      {state.status === 'done' && (
        <div className="mt-2 space-y-2">
          <Outcome envelope={state.envelope} overridden={state.overridden} />
          <ul className="space-y-1 text-ink">
            {state.envelope.why.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {state.envelope.decision.kind === 'ask' && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => { e.preventDefault(); if (reply.trim()) { onAnswer(reply); setReply(''); } }}
            >
              <label className="sr-only" htmlFor="ask-reply">{state.envelope.decision.prompt}</label>
              <input
                id="ask-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Your answer"
                className="min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-ink"
              />
              <button type="submit" className="rounded-lg bg-accent px-3 py-1 font-medium text-accent-ink">Answer</button>
              <p className="w-full text-xs text-muted">One answer is all it asks for. After that it builds or holds, and never asks again.</p>
            </form>
          )}
          {state.envelope.decision.kind === 'hold' && state.envelope.decision.reason === 'low_confidence' && !state.overridden && (
            <button type="button" onClick={onOverride} className="rounded-lg border border-edge px-3 py-1 text-ink hover:border-accent">
              Build anyway (my call)
            </button>
          )}
          <p className="text-xs text-muted">
            Decided by {SOURCE[state.envelope.source]}{state.envelope.model ? ` · ${state.envelope.model}` : ''} · {state.envelope.ms} ms. Policy and thresholds are code.
          </p>
        </div>
      )}
    </section>
  );
};

const Outcome: React.FC<{ envelope: DecisionEnvelope; overridden: boolean }> = ({ envelope, overridden }) => {
  const d = envelope.decision;
  if (d.kind === 'route') {
    return (
      <p className="font-medium text-ink">
        <StatusDot tone="ok" /> Route: {d.designSystem.replace('_', ' ')}, {d.renderMode === 'registry' ? 'registry' : 'sandboxed React'}
      </p>
    );
  }
  if (d.kind === 'ask') {
    return <p className="font-medium text-ink"><StatusDot tone="info" /> Question before building: {d.prompt}</p>;
  }
  return (
    <p className="font-medium text-ink">
      <StatusDot tone={d.reason === 'low_confidence' ? 'warn' : 'bad'} /> {HOLD_TITLE[d.reason]}
      {overridden ? ' (you chose to build anyway)' : ''}
    </p>
  );
};

/** Status color is always paired with text, never used alone. */
export const StatusDot: React.FC<{ tone: 'ok' | 'warn' | 'bad' | 'info' }> = ({ tone }) => {
  const cls = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[tone];
  return <span aria-hidden="true" className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${cls}`} />;
};
