import React, { useEffect, useRef, useState } from 'react';
import type { Example, UINode, UISpec } from '../shared/spec';
import { fetchExamples, streamSpec } from './api';
import { GeneratedApp } from './engine/GeneratedApp';
import { VoicePanel } from './voice/VoicePanel';

const SURPRISE_PROMPTS = [
  'a mortgage payment calculator with sliders for price, rate and term',
  'a pomodoro timer with start, pause and reset',
  'a tic-tac-toe game',
  'a unit converter between miles and kilometers',
  'a dice roller that shows two dice and the total',
  'a color palette generator with a base color picker',
  'a quiz: 3 questions about space with a score',
  'a savings goal tracker with a progress bar',
  'a BMI calculator with height and weight sliders',
  'a quarterly sales dashboard with KPI cards and a bar chart',
  'a currency tip splitter for a group dinner',
  'a countdown to the new year on a canvas',
];

type Prov = { kind: 'generate' | 'refine' | 'example'; text: string; source: string } | null;

/** Flatten a node's subtree into readable build-log entries (DFS). */
function logEntries(node: UINode): { type: string; label: string }[] {
  const label =
    (node.props?.title as string) ||
    (node.props?.label as string) ||
    (node.props?.stateKey as string) ||
    '';
  const here = { type: node.type, label: typeof label === 'string' ? label : '' };
  const kids = (node.children ?? []).flatMap(logEntries);
  return [here, ...kids];
}

export const App: React.FC = () => {
  const [examples, setExamples] = useState<Example[]>([]);
  const [prompt, setPrompt] = useState('');
  const [spec, setSpec] = useState<UISpec | null>(null);
  const [genId, setGenId] = useState(0);
  const [building, setBuilding] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [log, setLog] = useState<{ type: string; label: string }[]>([]);
  const [prov, setProv] = useState<Prov>(null);

  const specRef = useRef<UISpec | null>(null);
  specRef.current = spec;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const abortRef = useRef<AbortController | null>(null);
  const lastRun = useRef<() => void>(() => {});
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    fetchExamples().then(setExamples).catch(() => setExamples([]));
  }, []);

  function startStream(text: string, baseSpec?: UISpec) {
    const p = text.trim();
    if (!p) return;
    abortRef.current?.abort(); // interrupt any in-flight generation
    lastRun.current = () => startStream(text, baseSpec);
    abortRef.current = new AbortController();
    setBusy(true);
    setBuilding(true);
    setError(null);
    setShowSpec(false);
    setLog([]);
    if (!baseSpec) setSpec(null);

    streamSpec(
      { prompt: p, spec: baseSpec },
      {
        onMeta: (m) => {
          setProv((prev) => ({ kind: baseSpec ? 'refine' : 'generate', text: p, source: m.source }) as Prov);
          setSpec({ title: m.title ?? undefined, initialState: m.initialState, tree: [] });
          setCount(m.count);
          setGenId((n) => n + 1);
        },
        onNode: (n) => {
          setSpec((s) => (s ? { ...s, tree: [...s.tree, n.node] } : { tree: [n.node] }));
          setLog((l) => [...l, ...logEntries(n.node)]);
        },
        onDone: (d) => {
          setSpec(d.spec);
          setBuilding(false);
          setBusy(false);
        },
        onError: (e) => {
          setError(e);
          setBuilding(false);
          setBusy(false);
        },
      },
      abortRef.current.signal,
    ).catch((e) => {
      setError(String(e));
      setBuilding(false);
      setBusy(false);
    });
  }

  const submitPrompt = (p: string) => {
    setPrompt(p);
    startStream(p);
  };

  const submitRefine = (text: string) => {
    const t = text.trim();
    if (!t || !specRef.current) return;
    setRefineText('');
    startStream(t, specRef.current);
  };

  const surpriseIdx = useRef(Math.floor(Math.random() * SURPRISE_PROMPTS.length));
  const surprise = () => {
    surpriseIdx.current = (surpriseIdx.current + 1) % SURPRISE_PROMPTS.length;
    const pick = SURPRISE_PROMPTS[surpriseIdx.current];
    setPrompt(pick);
    startStream(pick);
  };

  const stop = () => {
    abortRef.current?.abort();
    setBuilding(false);
    setBusy(false);
  };

  // What the Gemini Live voice agent reads from (includes the live rendered text,
  // so read_ui returns the real on-screen values).
  const voiceContext = () => {
    const root = document.querySelector('section[aria-label="Generated interface"]');
    let readable = root ? (root as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : '';
    // Sandboxed lanes are cross-origin, so innerText can't see inside — but each
    // iframe posts a text digest we stash on its data-artifact-text attribute.
    const iframeText = Array.from(document.querySelectorAll<HTMLElement>('iframe[data-artifact-text]'))
      .map((el) => el.dataset.artifactText || '')
      .filter(Boolean)
      .join(' · ');
    if (iframeText) readable = (readable ? readable + ' · ' : '') + iframeText;
    const spec = specRef.current;
    if (spec && !readable) readable = (spec.title ? spec.title + '. ' : '') + 'An interactive app is shown (rendered in a sandbox).';
    else if (spec?.title) readable = spec.title + '. ' + readable;
    return { spec, readable };
  };
  // The voice agent changes the UI via tool calls; apply its returned spec.
  const applyVoiceSpec = (s: UISpec) => {
    setProv({ kind: 'refine', text: 'voice', source: 'gemini' });
    setSpec(s);
    setCount(s.tree.length);
    setGenId((n) => n + 1);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-10">
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel/60 px-3 py-1 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" /> Generative UI Playground
        </span>
        <h1 className="mt-4 bg-gradient-to-r from-ink to-accent-soft bg-clip-text text-4xl font-bold tracking-tight text-transparent">
          Describe an interface. Watch it build itself.
        </h1>
        <p className="mt-3 text-muted">
          Type a sentence and a working, interactive UI is generated live — then refine it by chat or voice.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-xs text-muted/70">
          A demo of how generative UI can be done — every interface here is generated by a model from a
          toolbox (registry components, a sandbox, and a freeform React lane). Nothing is hard-coded.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitPrompt(prompt);
        }}
        className="flex gap-2"
      >
        <input
          value={prompt}
          autoFocus
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="a tip calculator that splits the bill…"
          aria-label="Describe an interface to generate"
          className="flex-1 rounded-xl border border-edge bg-panel/70 px-4 py-3 text-ink placeholder:text-muted/70 outline-none focus:border-accent"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-xl border border-edge px-5 py-3 font-medium text-muted transition-colors hover:text-ink"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-xl bg-accent px-5 py-3 font-medium text-white shadow-lg shadow-accent/20 transition-colors hover:bg-accent-deep"
          >
            Generate
          </button>
        )}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={surprise}
          disabled={busy}
          className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent-soft transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          ✨ Surprise me
        </button>
        <span className="text-xs text-muted/60">examples:</span>
        {examples.map((ex) => (
          <button
            key={ex.id}
            onClick={() => submitPrompt(ex.prompt)}
            className="rounded-full border border-edge bg-panel/40 px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
          >
            {ex.title}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <span>Generation failed — the model may be busy. Please try again.</span>
          <button onClick={() => lastRun.current()} className="rounded border border-red-400/40 px-2 py-0.5 text-xs hover:bg-red-500/20">
            Retry
          </button>
        </div>
      )}

      {/* Concise status for screen readers — the generated UI itself is NOT a live
          region (it would flood AT with partial nodes as it streams in). */}
      <p className="sr-only" role="status" aria-live="polite">
        {building
          ? 'Generating interface…'
          : spec
            ? `Interface ready: ${spec.title ?? 'Generated UI'}, ${spec.tree.length} component${spec.tree.length === 1 ? '' : 's'}.`
            : ''}
      </p>

      <main className="mt-8 flex-1" aria-busy={busy}>
        {busy && !spec ? (
          <Skeleton prompt={prompt} />
        ) : spec ? (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="truncate text-sm uppercase tracking-wide text-muted">{spec.title ?? 'Generated UI'}</h2>
              {!building && spec.tree.length > 0 && (
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => setVoiceOpen((v) => !v)}
                    aria-expanded={voiceOpen}
                    className={`text-xs ${voiceOpen ? 'text-accent-soft' : 'text-muted hover:text-ink'}`}
                    title="Talk to it — Gemini Live voice reads and changes the UI"
                  >
                    🎙️ {voiceOpen ? 'Voice on' : 'Voice'}
                  </button>
                  <button
                    onClick={() => setShowSpec((s) => !s)}
                    aria-expanded={showSpec}
                    className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {showSpec ? 'Hide spec' : 'View spec'}
                  </button>
                </div>
              )}
            </div>

            {building && <BuildProgress have={spec.tree.length} count={count} log={log} />}
            {!building && prov && <Provenance prov={prov} />}

            <GeneratedApp key={genId} spec={spec} />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitRefine(refineText);
              }}
              className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-panel/60 p-2"
            >
              <span className="pl-2 text-xs text-muted">Refine</span>
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="make it dark · add a reset button · turn it into a bar chart…"
                disabled={busy}
                aria-label="Refine the generated UI"
                className="min-w-[12rem] flex-1 bg-transparent px-1 py-1.5 text-sm text-ink placeholder:text-muted/60 outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setVoiceOpen(true)}
                title="Talk to it with Gemini Live voice"
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
              >
                🎙️ Voice
              </button>
              <button
                type="submit"
                disabled={busy || !refineText.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-deep disabled:opacity-40"
              >
                Send
              </button>
            </form>

            <p className="mt-2 text-[11px] text-muted/60">
              🎙️ Tap “Voice” to talk to it — Gemini Live hears you, reads the data, and changes the UI in its own voice.
            </p>

            {showSpec && (
              <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-edge bg-canvas/80 p-4 text-xs text-muted">
                {JSON.stringify(spec, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <Gallery examples={examples} onPick={(ex) => submitPrompt(ex.prompt)} />
        )}
      </main>

      <footer className="mt-12 text-center text-xs text-muted">
        Hybrid engine · whitelisted registry + sandboxed widgets ·{' '}
        <a href="/docs" className="underline hover:text-ink">
          API docs
        </a>
      </footer>

      {voiceOpen && (
        <VoicePanel getContext={voiceContext} onSpec={applyVoiceSpec} specVersion={genId} onClose={() => setVoiceOpen(false)} />
      )}
    </div>
  );
};

const Skeleton: React.FC<{ prompt: string }> = ({ prompt }) => (
  <div className="rounded-2xl border border-edge bg-panel/60 p-6">
    <div className="flex items-center gap-2 text-sm text-accent-soft">
      <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
      Reading your prompt{prompt ? `: “${prompt}”` : ''}…
    </div>
    <div className="mt-5 space-y-3">
      {[80, 60, 70, 45].map((w, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-edge/70" style={{ width: `${w}%` }} />
      ))}
    </div>
  </div>
);

const BuildProgress: React.FC<{ have: number; count: number; log: { type: string; label: string }[] }> = ({ have, count, log }) => (
  <div className="mb-4 rounded-xl border border-edge bg-panel/40 p-3">
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-accent-soft">
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
        Assembling the interface…
      </span>
      <span className="text-muted">{have}/{Math.max(have, count)}</span>
    </div>
    <div className="h-1 w-full overflow-hidden rounded-full bg-edge">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${count ? Math.min(100, (have / count) * 100) : 0}%` }}
      />
    </div>
    <div className="mt-2 max-h-28 overflow-hidden font-mono text-[11px] leading-relaxed">
      {log.slice(-7).map((e, i) => {
        const sandboxed = e.type === 'CustomWidget' || e.type === 'ReactArtifact';
        const tag = e.type === 'ReactArtifact' ? '🔒 React+Tailwind' : '🔒 sandboxed';
        return (
          <div key={i} className="animate-rise">
            <span className={sandboxed ? 'text-amber-300' : 'text-accent-soft'}>+</span>{' '}
            <span className="text-muted">{e.type}</span>
            {e.label ? <span className="text-muted/70"> “{e.label}”</span> : null}
            {sandboxed ? (
              <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-300">{tag}</span>
            ) : (
              <span className="ml-1 rounded bg-accent/10 px-1 text-[10px] text-accent-soft/80">registry</span>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const Provenance: React.FC<{ prov: NonNullable<Prov> }> = ({ prov }) => {
  const label =
    prov.kind === 'refine'
      ? '✦ Refined'
      : prov.source === 'gemini'
        ? '✨ Generated by Gemini'
        : '✨ Generated (offline demo)';
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-edge bg-panel/40 px-3 py-2 text-xs">
      <span className="font-medium text-accent-soft">{label}</span>
      <span className="text-muted">from</span>
      <span className="truncate text-ink">“{prov.text}”</span>
    </div>
  );
};

const Gallery: React.FC<{ examples: Example[]; onPick: (ex: Example) => void }> = ({ examples, onPick }) => (
  <div>
    <p className="mb-4 text-center text-sm text-muted">…or start from a curated example</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {examples.map((ex) => (
        <button
          key={ex.id}
          onClick={() => onPick(ex)}
          className="rounded-2xl border border-edge bg-panel/50 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-accent/10"
        >
          <h3 className="font-semibold text-ink">{ex.title}</h3>
          <p className="mt-1 text-xs text-muted">{ex.blurb}</p>
        </button>
      ))}
    </div>
  </div>
);
