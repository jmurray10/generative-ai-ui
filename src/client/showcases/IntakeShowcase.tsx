import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { FIELDS, INTAKE_SAMPLES, flagFor, provisionalResult, validateField, type Extraction, type Flag } from '../../shared/intake';
import { DecisionPanel, StatusDot } from './DecisionPanel';
import { blockers, canGo, initialIntake, intakeReducer, STEPS, type Step } from './intake-state';
import { postJSON } from './sse';
import { canBuild, designFor, useDecision } from './useDecision';
import type { ShowcaseProps } from './Showcases';

const PROMPT = "A multi-step vendor onboarding wizard for procurement staff: extract fields from a vendor's email with confidence flags, fix gaps, review a provisional risk tier, then approve or send back.";

const FLAG_TEXT: Record<Flag, string> = { confident: 'Confident', check: 'Check', missing: 'Missing' };
const FLAG_TONE: Record<Flag, 'ok' | 'warn' | 'bad'> = { confident: 'ok', check: 'warn', missing: 'bad' };

export const IntakeShowcase: React.FC<ShowcaseProps> = ({ onDesign, onChange }) => {
  const { state: decision, decide, answer, override } = useDecision();
  const design = designFor(decision, 'soft_consumer');
  const route = decision.status === 'done' && decision.envelope.decision.kind === 'route' ? decision.envelope.decision : null;
  const [s, dispatch] = useReducer(intakeReducer, initialIntake);
  const abortRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { void decide(PROMPT); }, [decide]);
  useEffect(() => onDesign(design), [design, onDesign]);
  useEffect(() => onChange(), [s, decision, onChange]);
  useEffect(() => { headingRef.current?.focus(); }, [s.step]); // move focus to the new step for keyboard and screen readers
  useEffect(() => () => abortRef.current?.abort(), []);

  const extract = useCallback(async () => {
    if (!s.text.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: 'extract_start' });
    try {
      const { fields } = await postJSON<{ fields: Extraction }>('/api/showcase/intake/extract', { text: s.text }, ctrl.signal);
      if (!ctrl.signal.aborted) dispatch({ type: 'extract_ok', extraction: fields });
    } catch (e) {
      if (!ctrl.signal.aborted) dispatch({ type: 'extract_fail', error: (e as Error).message });
    }
  }, [s.text]);

  if (!canBuild(decision)) {
    return <div className="mx-auto max-w-xl"><DecisionPanel state={decision} onAnswer={answer} onOverride={override} onRetry={() => void decide(PROMPT)} /></div>;
  }

  const showApproval = !route || route.components.includes('approval_card');

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_20rem]">
      <div data-voice-surface="Intake wizard" className="min-w-0 space-y-4">
        <ol aria-label="Steps" className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => dispatch({ type: 'goto', step: i as Step })}
                disabled={!canGo(s, i as Step)}
                aria-current={s.step === i ? 'step' : undefined}
                className={`rounded-full border px-4 py-2 text-sm ${s.step === i ? 'border-accent bg-panel font-semibold text-ink' : 'border-edge text-muted'} disabled:opacity-50`}
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        <section className="rounded-2xl border border-edge bg-panel p-6 shadow-card" aria-labelledby="intake-step">
          <p className="text-sm text-muted">Step {s.step + 1} of {STEPS.length}: {STEPS[s.step]}</p>
          <h2 id="intake-step" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-semibold text-ink outline-none">
            {['Where are the vendor details?', 'Check what Grok pulled out', 'Review the provisional result', 'Approve or send back'][s.step]}
          </h2>

          {s.step === 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {INTAKE_SAMPLES.map((x) => (
                  <button key={x.id} type="button" onClick={() => dispatch({ type: 'text', text: x.text, sampleId: x.id })} aria-pressed={s.sampleId === x.id} className={`rounded-full border px-4 py-2 text-sm ${s.sampleId === x.id ? 'border-accent text-ink' : 'border-edge text-muted hover:text-ink'}`}>
                    Use sample: {x.title}
                  </button>
                ))}
              </div>
              <label htmlFor="intake-text" className="block text-sm text-muted">Paste the vendor's message</label>
              <textarea id="intake-text" rows={10} value={s.text} onChange={(e) => dispatch({ type: 'text', text: e.target.value })} className="w-full rounded-xl border border-edge bg-canvas p-3 text-ink" />
              {!s.text.trim() && <p className="text-sm text-muted">Nothing to extract yet. Pick a sample or paste a message.</p>}
              {s.status === 'error' && (
                <p role="alert" className="text-ink"><StatusDot tone="bad" />Extraction failed: {s.error} Your text is still here; try again.</p>
              )}
              <button type="button" onClick={() => void extract()} disabled={!s.text.trim() || s.status === 'extracting'} className="rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink disabled:opacity-50">
                {s.status === 'extracting' ? 'Grok is reading the message…' : s.extraction ? 'Extract again' : 'Extract fields'}
              </button>
              {s.status === 'extracting' && <p role="status" className="text-sm text-muted">Reading the message and checking each quote against it.</p>}
            </div>
          )}

          {s.step === 1 && s.extraction && <FieldsStep s={s} dispatch={dispatch} extraction={s.extraction} />}

          {s.step === 2 && <ReviewStep values={s.values} edited={s.edited} />}

          {s.step === 3 && <DecisionStep s={s} dispatch={dispatch} showApproval={showApproval} />}
        </section>

        <div className="flex justify-between">
          <button type="button" onClick={() => dispatch({ type: 'goto', step: Math.max(0, s.step - 1) as Step })} disabled={s.step === 0} className="rounded-full border border-edge px-5 py-2 text-ink disabled:opacity-40">Back</button>
          {s.step < 3 && s.step > 0 && (
            <button type="button" onClick={() => dispatch({ type: 'goto', step: (s.step + 1) as Step })} disabled={!canGo(s, (s.step + 1) as Step)} className="rounded-full bg-accent px-6 py-2 font-semibold text-accent-ink disabled:opacity-50">
              Next
            </button>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <DecisionPanel state={decision} onAnswer={answer} onOverride={override} onRetry={() => void decide(PROMPT)} />
        <section aria-labelledby="audit" data-voice-surface="Audit trail" className="rounded-2xl border border-edge bg-panel p-4 text-sm">
          <h2 id="audit" className="font-semibold text-ink">Audit trail</h2>
          {s.audit.length === 0 ? <p className="mt-1 text-muted">Nothing has happened yet.</p> : (
            <ol className="mt-1 space-y-1">{s.audit.map((a, i) => <li key={i}><span className="font-data text-xs text-muted">{a.at.slice(11, 19)}Z</span> {a.what}</li>)}</ol>
          )}
        </section>
      </aside>
    </div>
  );
};

type Dispatch = React.Dispatch<Parameters<typeof intakeReducer>[1]>;

const FieldsStep: React.FC<{ s: ReturnType<typeof intakeReducer>; dispatch: Dispatch; extraction: Extraction }> = ({ s, dispatch, extraction }) => {
  const open = blockers(s);
  return (
    <div className="mt-4 space-y-4">
      <p className="text-muted">{open.length ? `${open.length} field${open.length > 1 ? 's' : ''} still need you before review.` : 'Every field is ready for review.'}</p>
      {FIELDS.map((def) => {
        const ex = extraction[def.id];
        const flag = flagFor(ex);
        const invalid = validateField(def, s.values[def.id]);
        const needsConfirm = flag !== 'confident' && !s.edited[def.id] && !invalid;
        const inputId = `f-${def.id}`;
        return (
          <div key={def.id} className="border-t border-edge pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={inputId} className="font-semibold text-ink">{def.label}</label>
              <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-ink"><StatusDot tone={FLAG_TONE[flag]} />{FLAG_TEXT[flag]}{ex?.value ? ` · ${Math.round(ex.confidence * 100)}%` : ''}</span>
              {s.edited[def.id] && <span className="text-xs text-muted">Changed by you</span>}
            </div>
            <input id={inputId} value={s.values[def.id] ?? ''} placeholder={def.hint} onChange={(e) => dispatch({ type: 'edit', id: def.id, value: e.target.value })} aria-invalid={Boolean(invalid)} aria-describedby={`${inputId}-help`} className="mt-1 w-full rounded-xl border border-edge bg-canvas px-3 py-2 text-ink" />
            <p id={`${inputId}-help`} className="mt-1 text-sm text-muted">
              {invalid ? invalid : ex?.quote ? (ex.quoteFound ? `From the message: "${ex.quote}"` : `Grok quoted "${ex.quote}", but that text is not in the message.`) : 'Not stated in the message.'}
            </p>
            {needsConfirm && (
              <label className="mt-1 inline-flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={Boolean(s.confirmed[def.id])} onChange={(e) => dispatch({ type: 'confirm', id: def.id, value: e.target.checked })} />
                I checked this value
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
};

const ReviewStep: React.FC<{ values: Parameters<typeof provisionalResult>[0]; edited: Record<string, boolean | undefined> }> = ({ values, edited }) => {
  const r = provisionalResult(values);
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-edge bg-canvas p-4">
        <p className="text-sm text-muted">Provisional result. Nothing is final until someone approves it.</p>
        <p className="mt-1 font-display text-xl font-semibold text-ink">{r.tier === 'enhanced' ? 'Enhanced review' : 'Standard onboarding'}</p>
        <ul className="mt-2 list-disc pl-5 text-ink">
          {r.reasons.length ? r.reasons.map((x) => <li key={x}>{x}</li>) : <li>No risk rule fired.</li>}
        </ul>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.id}>
            <dt className="text-sm text-muted">{f.label}{edited[f.id] ? ' (changed by you)' : ''}</dt>
            <dd className="text-ink">{values[f.id] || 'Not provided'}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 text-sm">
        {r.checks.map((c) => <li key={c.label} className="text-ink"><StatusDot tone={c.ok ? 'ok' : 'bad'} />{c.ok ? 'Pass' : 'Fail'}: {c.label}</li>)}
      </ul>
    </div>
  );
};

const DecisionStep: React.FC<{ s: ReturnType<typeof intakeReducer>; dispatch: Dispatch; showApproval: boolean }> = ({ s, dispatch, showApproval }) => {
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState('');
  const r = provisionalResult(s.values);
  if (s.outcome) {
    return (
      <div className="mt-4 space-y-2" role="status">
        <p className="text-xl font-semibold text-ink"><StatusDot tone={s.outcome.kind === 'approved' ? 'ok' : 'warn'} />{s.outcome.kind === 'approved' ? `Approved for ${r.tier === 'enhanced' ? 'enhanced review' : 'standard onboarding'}.` : 'Sent back to the requester.'}</p>
        {s.outcome.note && <p className="text-ink">Note: {s.outcome.note}</p>}
        <p className="text-muted">This is a demo: nothing was sent anywhere.</p>
        <button type="button" onClick={() => dispatch({ type: 'reset' })} className="rounded-full border border-edge px-5 py-2 text-ink">Start a new intake</button>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-4">
      <p className="text-ink">Provisional result: {r.tier === 'enhanced' ? 'Enhanced review' : 'Standard onboarding'}. Not decided yet.</p>
      {!r.ready && <p className="text-ink"><StatusDot tone="bad" />Some checks fail, so this cannot be approved. Send it back or go back and fix the fields.</p>}
      {showApproval && (
        <div className="rounded-2xl border border-edge bg-canvas p-4">
          <p className="font-semibold text-ink">Approve {s.values.legal_name || 'this vendor'} for {r.tier === 'enhanced' ? 'enhanced review' : 'standard onboarding'}</p>
          <label className="mt-2 flex items-center gap-2 text-ink">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            I reviewed every field and the provisional result
          </label>
          <button type="button" disabled={!reviewed || !r.ready} onClick={() => dispatch({ type: 'decide', kind: 'approved', note: '' })} className="mt-3 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink disabled:opacity-50">
            Approve
          </button>
        </div>
      )}
      <div>
        <label htmlFor="sendback-note" className="block font-semibold text-ink">Or send it back</label>
        <textarea id="sendback-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Say what is missing and what they should do next" className="mt-1 w-full rounded-xl border border-edge bg-canvas p-3 text-ink" />
        <button type="button" disabled={!note.trim()} onClick={() => dispatch({ type: 'decide', kind: 'sent_back', note })} className="mt-2 rounded-full border border-edge px-5 py-2 text-ink disabled:opacity-50">
          Send back
        </button>
      </div>
    </div>
  );
};
