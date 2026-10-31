import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { UISpec } from '../../shared/spec';
import { DESIGN_SYSTEMS, type DesignSystem, type RenderMode } from '../../shared/toolbox';
import { streamSpec } from '../api';
import { GeneratedApp } from '../engine/GeneratedApp';
import { DecisionPanel } from './DecisionPanel';
import { canBuild, designFor, useDecision } from './useDecision';
import type { ShowcaseProps } from './Showcases';

type Slot = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'done'; spec: UISpec; degraded: boolean };
type View = 'regenerated' | 'tokens-only';

const PROMPT = "A monthly report for a neighborhood library's members: total book loans, the top five genres as a bar chart, and a short note from the head librarian.";
const EMPTY: Record<DesignSystem, Slot> = { editorial_serif: { status: 'idle' }, ops_console: { status: 'idle' }, soft_consumer: { status: 'idle' } };

export const DesignSystemsShowcase: React.FC<ShowcaseProps> = ({ onDesign, onChange }) => {
  const [prompt, setPrompt] = useState(PROMPT);
  const { state, decide, answer, override } = useDecision();
  const picked = designFor(state, 'editorial_serif');
  const routedLane: RenderMode = state.status === 'done' && state.envelope.decision.kind === 'route' ? state.envelope.decision.renderMode : 'registry';
  const [lane, setLane] = useState<RenderMode>('registry');
  const [active, setActive] = useState<DesignSystem>('editorial_serif');
  const [view, setView] = useState<View>('regenerated');
  const [slots, setSlots] = useState<Record<DesignSystem, Slot>>(EMPTY);
  const aborts = useRef<AbortController[]>([]);

  useEffect(() => { setActive(picked); }, [picked]);
  useEffect(() => { setLane(routedLane); }, [routedLane]);
  useEffect(() => onDesign(active), [active, onDesign]);
  useEffect(() => onChange(), [state, slots, active, view, onChange]);
  useEffect(() => () => aborts.current.forEach((a) => a.abort()), []);

  const generateAll = useCallback(() => {
    aborts.current.forEach((a) => a.abort());
    aborts.current = [];
    setSlots({ editorial_serif: { status: 'loading' }, ops_console: { status: 'loading' }, soft_consumer: { status: 'loading' } });
    for (const d of DESIGN_SYSTEMS) {
      const ctrl = new AbortController();
      aborts.current.push(ctrl);
      let degraded = false;
      const set = (slot: Slot) => setSlots((s) => ({ ...s, [d.id]: slot }));
      streamSpec({ prompt, designSystem: d.id, lane }, {
        onMeta: (m) => { degraded = Boolean(m.degraded); },
        onDone: ({ spec }) => set({ status: 'done', spec, degraded }),
        onError: (e) => set({ status: 'error', error: e }),
      }, ctrl.signal).catch((e) => set({ status: 'error', error: String(e) }));
    }
  }, [prompt, lane]);

  // Number keys 1–3 switch the design system (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]')) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < DESIGN_SYSTEMS.length) setActive(DESIGN_SYSTEMS[i].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Token-only view: one spec (the decision's pick), re-rendered under each token file.
  const source = view === 'tokens-only' ? slots[picked] : slots[active];
  const tokensOnlyBlocked = view === 'tokens-only' && lane === 'sandboxed_react';

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <form className="space-y-2 border border-edge bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void decide(prompt); }}>
          <label htmlFor="ds-prompt" className="block text-xs font-semibold uppercase tracking-wider text-muted">One prompt</label>
          <textarea id="ds-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-ink" />
          <button type="submit" className="rounded-lg border border-edge px-3 py-1 text-sm text-ink hover:border-accent">1. Decide tools</button>
        </form>
        <DecisionPanel state={state} onAnswer={answer} onOverride={override} onRetry={() => void decide(prompt)} />
        <fieldset className="border border-edge bg-panel p-3 text-sm">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Render path</legend>
          {(['registry', 'sandboxed_react'] as RenderMode[]).map((l) => (
            <label key={l} className="mr-4 inline-flex items-center gap-1">
              <input type="radio" name="lane" checked={lane === l} onChange={() => setLane(l)} />
              {l === 'registry' ? 'Registry components' : 'Sandboxed React'}{l === routedLane && state.status === 'done' ? ' (decided)' : ''}
            </label>
          ))}
          <button type="button" disabled={!canBuild(state)} onClick={generateAll} className="mt-2 block rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink disabled:opacity-50">
            2. Generate under all three DESIGN.md files
          </button>
          <p className="mt-2 text-muted">Each DESIGN.md goes verbatim into grok-4.7's instructions. Registry UIs read only the token file.</p>
        </fieldset>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3 border border-edge bg-panel p-2 text-sm">
          <div role="radiogroup" aria-label="Design system" className="flex gap-1">
            {DESIGN_SYSTEMS.map((d, i) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={active === d.id}
                onClick={() => setActive(d.id)}
                className={`rounded-lg border px-3 py-1 ${active === d.id ? 'border-accent bg-canvas text-ink' : 'border-edge text-muted hover:text-ink'}`}
              >
                <span className="font-data text-xs">{i + 1}</span> {d.label}{d.id === picked && state.status === 'done' ? ' · decided' : ''}
              </button>
            ))}
          </div>
          <label className="ml-auto inline-flex items-center gap-2">
            <input type="checkbox" checked={view === 'tokens-only'} onChange={(e) => setView(e.target.checked ? 'tokens-only' : 'regenerated')} />
            Same spec, swap only the token file
          </label>
        </div>
        <section aria-label="Rendered result" data-voice-surface="Design system preview" className="min-h-[28rem]">
          <p className="mb-2 text-sm text-muted">
            Showing {DESIGN_SYSTEMS.find((d) => d.id === active)?.label}
            {view === 'tokens-only' ? `, rendering the spec Grok wrote for ${picked.replace('_', ' ')}` : ', generated with its own DESIGN.md'}.
          </p>
          {tokensOnlyBlocked ? (
            <p className="text-ink">A sandboxed React artifact styles itself, so swapping tokens cannot restyle it. Switch to the registry path to compare token files.</p>
          ) : (
            <SlotView slot={source} design={active} />
          )}
        </section>
      </div>
    </div>
  );
};

const SlotView: React.FC<{ slot: Slot; design: DesignSystem }> = ({ slot, design }) => {
  if (slot.status === 'idle') return <p className="text-muted">Nothing generated yet. Decide the tools, then generate under all three DESIGN.md files.</p>;
  if (slot.status === 'loading') return <p className="text-muted" role="status">Grok is generating with this DESIGN.md…</p>;
  if (slot.status === 'error') return <p className="text-ink" role="alert">Generation failed: {slot.error}</p>;
  return (
    <div data-design={design}>
      {slot.degraded && <p className="mb-2 text-ink">This result is a fallback notice, not a real generation.</p>}
      <GeneratedApp key={`${design}-${slot.spec.title}`} spec={slot.spec} designSystem={design} />
    </div>
  );
};
