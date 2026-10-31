import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewDoc, VerifiedCitation, WorkbenchAnswer } from '../../shared/workbench';
import { DecisionPanel, StatusDot } from './DecisionPanel';
import { postJSON } from './sse';
import { canBuild, designFor, useDecision } from './useDecision';
import type { ShowcaseProps } from './Showcases';

const PROMPT = 'A review workbench for contract analysts: a queue of submitted documents, a document viewer with highlighted citations, and an AI answer panel that links every claim back to page and line.';

/** Demo toggle. "live" is the real flow; the others force one honest state through the real code path. */
type Forced = 'live' | 'empty' | 'loading' | 'error' | 'unverifiable';
const FORCED: { id: Forced; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'empty', label: 'Empty' },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Error' },
  { id: 'unverifiable', label: "Couldn't verify" },
];

type Docs = { status: 'loading' } | { status: 'error'; error: string } | { status: 'done'; docs: ReviewDoc[] };
type Ans = { status: 'empty' } | { status: 'loading'; question: string } | { status: 'error'; question: string; error: string } | { status: 'done'; answer: WorkbenchAnswer };

const lineId = (page: number, line: number) => `wb-p${page}-l${line}`;

export const WorkbenchShowcase: React.FC<ShowcaseProps> = ({ onDesign, onChange }) => {
  const { state, decide, answer: answerAsk, override } = useDecision();
  const design = designFor(state, 'ops_console');
  const route = state.status === 'done' && state.envelope.decision.kind === 'route' ? state.envelope.decision : null;
  const verifyOn = !route || route.checks.includes('couldnt_verify_state');
  const [forced, setForced] = useState<Forced>('live');
  const [docs, setDocs] = useState<Docs>({ status: 'loading' });
  const [selected, setSelected] = useState(0);
  const [ans, setAns] = useState<Ans>({ status: 'empty' });
  const [question, setQuestion] = useState('');
  const [activeCite, setActiveCite] = useState<number>(-1);
  const queueRef = useRef<HTMLUListElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const askAbort = useRef<AbortController | null>(null);

  useEffect(() => { void decide(PROMPT); }, [decide]);
  useEffect(() => onDesign(design), [design, onDesign]);
  useEffect(() => onChange(), [docs, ans, selected, forced, state, onChange]);

  const loadDocs = useCallback(async (mode: Forced) => {
    if (mode === 'loading') return setDocs({ status: 'loading' });
    setDocs({ status: 'loading' });
    const q = mode === 'empty' ? '?simulate=empty' : mode === 'error' ? '?simulate=error' : '';
    try {
      const res = await fetch(`/api/showcase/workbench/docs${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      setDocs({ status: 'done', docs: body as ReviewDoc[] });
    } catch (e) {
      setDocs({ status: 'error', error: (e as Error).message });
    }
  }, []);

  useEffect(() => { void loadDocs(forced); setAns(forced === 'loading' ? { status: 'loading', question: 'Waiting on the forced loading state' } : { status: 'empty' }); setSelected(0); }, [forced, loadDocs]);

  const list = docs.status === 'done' ? docs.docs : [];
  const doc = list[selected];

  const ask = useCallback(async (q: string) => {
    if (!doc || !q.trim()) return;
    askAbort.current?.abort();
    const ctrl = new AbortController();
    askAbort.current = ctrl;
    setAns({ status: 'loading', question: q });
    setActiveCite(-1);
    const simulate = forced === 'unverifiable' ? 'unverifiable' : forced === 'error' ? 'error' : undefined;
    try {
      const answer = await postJSON<WorkbenchAnswer>('/api/showcase/workbench/ask', { docId: doc.id, question: q, simulate }, ctrl.signal);
      if (!ctrl.signal.aborted) setAns({ status: 'done', answer });
    } catch (e) {
      if (!ctrl.signal.aborted) setAns({ status: 'error', question: q, error: (e as Error).message });
    }
  }, [doc, forced]);

  const citations: VerifiedCitation[] = useMemo(
    () => (ans.status === 'done' ? ans.answer.claims.flatMap((c) => c.citations) : []),
    [ans],
  );
  const highlighted = useMemo(() => new Map(citations.map((c) => [lineId(c.page, c.line), c.verified])), [citations]);

  const focusCite = useCallback((i: number) => {
    const c = citations[i];
    if (!c) return;
    setActiveCite(i);
    document.getElementById(lineId(c.page, c.line))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [citations]);

  // Keyboard: j/k move through the queue, / jumps to the question, [ and ] step through citations.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select')) return;
      if (e.key === 'j' || e.key === 'k') {
        if (!list.length) return;
        e.preventDefault();
        setSelected((s) => Math.max(0, Math.min(list.length - 1, s + (e.key === 'j' ? 1 : -1))));
        setAns({ status: 'empty' });
      } else if (e.key === '/') {
        e.preventDefault();
        questionRef.current?.focus();
      } else if (e.key === ']' || e.key === '[') {
        if (!citations.length) return;
        focusCite((activeCite + (e.key === ']' ? 1 : citations.length - 1)) % citations.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, citations.length, activeCite, focusCite]);

  if (!canBuild(state)) {
    return (
      <div className="max-w-xl">
        <DecisionPanel state={state} onAnswer={answerAsk} onOverride={override} onRetry={() => void decide(PROMPT)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid items-start gap-3 lg:grid-cols-[1fr_22rem]">
        <div role="radiogroup" aria-labelledby="wb-forced" className="flex flex-wrap items-center gap-2 border border-edge bg-panel px-3 py-2 text-sm">
          <span id="wb-forced" className="text-muted">Preview a state (demo toggle):</span>
          {FORCED.map((f) => (
            <label key={f.id} className={`cursor-pointer rounded-lg border px-2 py-0.5 ${forced === f.id ? 'border-accent text-ink' : 'border-edge text-muted'}`}>
              <input type="radio" name="forced" value={f.id} checked={forced === f.id} onChange={() => setForced(f.id)} className="sr-only" />
              {f.label}
            </label>
          ))}
          <span className="ml-auto font-data text-xs text-muted">j/k queue · / ask · [ ] citations</span>
        </div>
        <DecisionPanel state={state} onAnswer={answerAsk} onOverride={override} onRetry={() => void decide(PROMPT)} />
      </div>

      <div data-voice-surface="Review workbench" className="grid min-h-[34rem] border border-edge lg:grid-cols-[16rem_1fr_24rem]">
        {/* Queue */}
        <section aria-labelledby="wb-queue" className="border-b border-edge bg-panel lg:border-b-0 lg:border-r">
          <h2 id="wb-queue" className="border-b border-edge px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">Queue</h2>
          {docs.status === 'loading' && <SkeletonRows label="Loading the queue…" />}
          {docs.status === 'error' && <PanelError message={`The queue did not load: ${docs.error}`} onRetry={() => void loadDocs(forced === 'error' ? 'live' : forced)} />}
          {docs.status === 'done' && list.length === 0 && <p className="p-3 text-sm text-muted">No documents are waiting for review.</p>}
          {list.length > 0 && (
            <ul ref={queueRef} role="listbox" aria-label="Documents to review" aria-activedescendant={`wb-doc-${selected}`} tabIndex={0} className="outline-none">
              {list.map((d, i) => (
                <li
                  key={d.id}
                  id={`wb-doc-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  onClick={() => { setSelected(i); setAns({ status: 'empty' }); }}
                  className={`cursor-pointer border-b border-edge px-3 py-2 text-sm ${i === selected ? 'bg-canvas text-ink' : 'text-muted hover:text-ink'}`}
                >
                  <div className="font-medium text-ink">{d.title}</div>
                  <div className="font-data text-xs">{d.id} · {d.kind} · {d.submittedBy} · {d.received}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Document viewer */}
        <section aria-labelledby="wb-doc" className="min-w-0 border-b border-edge lg:border-b-0 lg:border-r">
          <h2 id="wb-doc" className="border-b border-edge px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Document{doc ? `: ${doc.title}` : ''}
          </h2>
          {docs.status === 'loading' && <SkeletonRows label="Loading the document…" rows={10} />}
          {docs.status === 'error' && <p className="p-3 text-sm text-muted">No document to show while the queue is unavailable.</p>}
          {docs.status === 'done' && !doc && <p className="p-3 text-sm text-muted">Pick a document from the queue.</p>}
          {doc && (
            <div className="max-h-[32rem] overflow-y-auto p-3">
              {doc.pages.map((p) => (
                <div key={p.page} className="mb-4">
                  <div className="mb-1 font-data text-xs text-muted">Page {p.page}</div>
                  <ol className="space-y-0.5">
                    {p.lines.map((l, i) => {
                      const id = lineId(p.page, i + 1);
                      const mark = highlighted.get(id);
                      const isActive = activeCite >= 0 && citations[activeCite] && lineId(citations[activeCite].page, citations[activeCite].line) === id;
                      return (
                        <li key={id} id={id} className={`grid grid-cols-[2.5rem_1fr] gap-2 text-sm ${mark === true ? 'bg-ok/15' : mark === false ? 'bg-warn/15' : ''} ${isActive ? 'outline outline-1 outline-accent' : ''}`}>
                          <span className={`select-none text-right font-data text-xs ${mark === undefined ? 'text-muted' : 'text-ink'}`}>L{i + 1}</span>
                          <span>{l}{mark !== undefined && <span className="sr-only">{mark ? ' (cited, verified)' : ' (cited, not verified)'}</span>}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Answer panel */}
        <section aria-labelledby="wb-answer" className="min-w-0 bg-panel">
          <h2 id="wb-answer" className="border-b border-edge px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">AI answer</h2>
          <div className="space-y-3 p-3 text-sm">
            <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="flex gap-2">
              <label htmlFor="wb-question" className="sr-only">Ask about this document</label>
              <input id="wb-question" ref={questionRef} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!doc} placeholder={doc ? 'Ask about this document' : 'No document selected'} className="min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-ink disabled:opacity-60" />
              <button type="submit" disabled={!doc || !question.trim()} className="rounded-lg bg-accent px-3 py-1 font-medium text-accent-ink disabled:opacity-50">Ask</button>
            </form>
            {doc && (
              <div className="flex flex-col gap-1">
                {doc.questions.map((q) => (
                  <button key={q} type="button" onClick={() => { setQuestion(q); void ask(q); }} className="rounded-lg border border-edge px-2 py-1 text-left text-muted hover:border-accent hover:text-ink">{q}</button>
                ))}
              </div>
            )}
            <AnswerView ans={ans} verifyOn={verifyOn} onCite={(c) => focusCite(citations.indexOf(c))} onRetry={() => ans.status === 'error' && void ask(ans.question)} hasDoc={Boolean(doc)} />
          </div>
        </section>
      </div>
    </div>
  );
};

const AnswerView: React.FC<{ ans: Ans; verifyOn: boolean; hasDoc: boolean; onCite: (c: VerifiedCitation) => void; onRetry: () => void }> = ({ ans, verifyOn, hasDoc, onCite, onRetry }) => {
  if (ans.status === 'empty') return <p className="text-muted">{hasDoc ? 'No question asked yet. Pick one above or type your own.' : 'Nothing to answer yet.'}</p>;
  if (ans.status === 'loading') return <SkeletonRows label={`Asking Grok: ${ans.question}`} rows={4} />;
  if (ans.status === 'error') return <PanelError message={`No answer: ${ans.error}`} onRetry={onRetry} />;
  const a = ans.answer;
  const unverified = a.status === 'couldnt_verify';
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="font-medium text-ink">
        <StatusDot tone={!verifyOn || unverified ? 'warn' : 'ok'} />
        {!verifyOn
          ? 'Citation check is off for this route, so treat this answer as unverified.'
          : unverified ? "Couldn't verify this answer against the document." : 'Verified: every claim matches the cited line.'}
      </p>
      <p className="text-ink">{a.answer}</p>
      {a.claims.length > 0 && (
        <ul className="space-y-1">
          {a.claims.map((cl, i) => (
            <li key={i} className="border-t border-edge pt-1">
              <span className="text-ink">{cl.text}</span>{' '}
              {cl.citations.map((c, j) => (
                <button key={j} type="button" onClick={() => onCite(c)} className="mr-1 inline-flex items-center rounded-lg border border-edge px-1.5 font-data text-xs text-ink hover:border-accent">
                  <StatusDot tone={c.verified ? 'ok' : 'warn'} />p{c.page} · L{c.line}{c.verified ? '' : ' · not found'}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {verifyOn && unverified && a.problems.length > 0 && (
        <div className="border border-warn/50 bg-warn/10 p-2">
          <p className="font-medium text-ink">What could not be checked</p>
          <ul className="list-disc pl-5 text-ink">{a.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="mt-1 text-ink">Read the cited lines yourself before relying on this.</p>
        </div>
      )}
      <p className="text-xs text-muted">Answer by {a.model}. Citations are checked by code, not by the model.</p>
    </div>
  );
};

const SkeletonRows: React.FC<{ label: string; rows?: number }> = ({ label, rows = 5 }) => (
  <div className="p-3" role="status">
    <p className="mb-2 text-sm text-muted">{label}</p>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="mb-1 h-5 animate-pulse bg-edge" style={{ width: `${60 + ((i * 37) % 40)}%` }} />)}
  </div>
);

const PanelError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="p-3 text-sm" role="alert">
    <p className="text-ink"><StatusDot tone="bad" />{message}</p>
    <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-edge px-3 py-1 text-ink hover:border-accent">Retry</button>
  </div>
);
