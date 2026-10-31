import React, { useCallback, useEffect, useRef, useState } from 'react';
import { registry } from '../engine/components';
import { DecisionPanel } from './DecisionPanel';
import { postSSE } from './sse';
import { canBuild, designFor, useDecision } from './useDecision';
import type { ShowcaseProps } from './Showcases';

interface Group { antipattern: string; name: string; severity: string; count: number; snippets: string[] }
interface Round {
  round: number;
  previewId: string;
  code: string;
  urlCount: number | null;
  dirCount: number;
  count: number;
  compacted: { count: number; groups: Group[] };
  changes?: { antipattern: string; change: string; where?: string }[];
  unfixed?: { antipattern: string; why: string }[];
  detectError?: string;
}
interface Done { history: { round: number; count: number }[]; best: number; stopReason: string; summary: string }

type Run =
  | { status: 'idle' }
  | { status: 'running'; note: string }
  | { status: 'done'; done: Done }
  | { status: 'error'; error: string };

const ReactArtifact = registry.ReactArtifact;
const VAGUE = 'a modern SaaS analytics dashboard';

export const CritiqueShowcase: React.FC<ShowcaseProps> = ({ onDesign, onChange }) => {
  const [prompt, setPrompt] = useState(VAGUE);
  const { state, decide, answer, override } = useDecision();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [shown, setShown] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const design = designFor(state, 'ops_console');

  useEffect(() => onDesign(design), [design, onDesign]);
  useEffect(() => onChange(), [state, rounds, run, onChange]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRounds([]);
    setRun({ status: 'running', note: 'Starting…' });
    // Round 0 uses the ORIGINAL vague prompt with no DESIGN.md. Fixes follow the routed DESIGN.md.
    postSSE('/api/showcase/critique', { prompt, designSystem: design }, (event, data) => {
      if (event === 'status') setRun({ status: 'running', note: data.text });
      else if (event === 'round') { setRounds((r) => [...r, data as Round]); setShown((data as Round).round); }
      else if (event === 'done') { setRun({ status: 'done', done: data as Done }); setShown((data as Done).best); }
      else if (event === 'error') setRun({ status: 'error', error: data.error });
    }, ctrl.signal).catch((e) => { if (!ctrl.signal.aborted) setRun({ status: 'error', error: (e as Error).message }); });
  }, [prompt, design]);

  const current = rounds.find((r) => r.round === shown);
  const max = Math.max(1, ...rounds.map((r) => r.count));

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <form className="space-y-2 border border-edge bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void decide(prompt); }}>
          <label htmlFor="critique-prompt" className="block text-xs font-semibold uppercase tracking-wider text-muted">Prompt (kept vague on purpose)</label>
          <input id="critique-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-ink" />
          <button type="submit" className="rounded-lg border border-edge px-3 py-1 text-sm text-ink hover:border-accent">1. Decide tools</button>
        </form>
        <DecisionPanel state={state} onAnswer={answer} onOverride={override} onRetry={() => void decide(prompt)} />
        <div className="border border-edge bg-panel p-3 text-sm">
          <p className="text-muted">Round 0 runs the prompt above with no DESIGN.md. Each later round sends Grok the Impeccable findings and the {design.replace('_', ' ')} DESIGN.md. Up to 3 fix rounds; stops early at 0 or when a round does not improve.</p>
          <button
            type="button"
            disabled={!canBuild(state) || run.status === 'running'}
            onClick={start}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink disabled:opacity-50"
          >
            2. Run the critique loop
          </button>
          {!canBuild(state) && run.status !== 'running' && (
            <p className="mt-2 text-xs text-muted">{state.status === 'done' && state.envelope.decision.kind === 'ask' ? 'Answer the question above first.' : 'Decide the tools first.'}</p>
          )}
        </div>
        <section aria-labelledby="round-log" data-voice-surface="Critique rounds" className="border border-edge bg-panel p-3 text-sm">
          <h2 id="round-log" className="text-xs font-semibold uppercase tracking-wider text-muted">Round log</h2>
          {run.status === 'idle' && rounds.length === 0 && <p className="mt-2 text-muted">No rounds yet.</p>}
          {run.status === 'running' && <p className="mt-2 text-ink" role="status">{run.note}</p>}
          {run.status === 'error' && <p className="mt-2 text-ink" role="alert">The loop stopped with an error: {run.error}</p>}
          <ol className="mt-2 space-y-1">
            {rounds.map((r) => (
              <li key={r.round}>
                <button type="button" onClick={() => setShown(r.round)} aria-pressed={shown === r.round} className="flex w-full items-center gap-2 text-left">
                  <span className="w-16 shrink-0 font-data text-xs">Round {r.round}</span>
                  <span className="h-2 bg-warn/70" style={{ width: `${(r.count / max) * 9}rem` }} aria-hidden="true" />
                  <span className="font-data text-xs">{r.count} findings{r.urlCount === null ? ' (source scan only)' : ''}</span>
                </button>
              </li>
            ))}
          </ol>
          {run.status === 'done' && <p className="mt-2 text-ink">{run.done.summary}</p>}
        </section>
      </div>

      <div className="min-w-0 space-y-3">
        {current ? (
          <>
            <section aria-labelledby="round-detail" data-voice-surface="Selected round" className="border border-edge bg-panel p-3 text-sm">
              <h2 id="round-detail" className="font-display text-base font-semibold">
                Round {current.round}: {current.count} findings on the rendered page
                <span className="font-normal text-muted"> · source scan {current.dirCount}</span>
              </h2>
              {current.detectError && <p className="text-muted">Detector note: {current.detectError}</p>}
              {current.compacted.groups.length === 0 ? (
                <p className="mt-1 text-ink">Impeccable found nothing to flag.</p>
              ) : (
                <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                  {current.compacted.groups.map((g) => <li key={g.antipattern}><span className="font-data">{g.count}×</span> {g.name}</li>)}
                </ul>
              )}
              {current.changes && current.changes.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted">What Grok changed going into this round ({current.changes.length})</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {current.changes.map((c, i) => <li key={i}><span className="font-data">{c.antipattern}</span>: {c.change}</li>)}
                  </ul>
                </details>
              )}
            </section>
            <ReactArtifact code={current.code} height={640} />
          </>
        ) : (
          <div className="grid min-h-[24rem] place-items-center border border-dashed border-edge p-6 text-center text-muted">
            {run.status === 'running' ? 'Generating round 0…' : 'Each round renders here, with its Impeccable findings beside it.'}
          </div>
        )}
      </div>
    </div>
  );
};
