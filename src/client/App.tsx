import React, { useEffect, useRef, useState } from 'react';
import type { Example, UISpec } from '../shared/spec';
import { fetchExamples, streamSpec } from './api';
import { GeneratedApp } from './engine/GeneratedApp';
import { useVoice } from './useVoice';

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

  const specRef = useRef<UISpec | null>(null);
  specRef.current = spec;
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    fetchExamples().then(setExamples).catch(() => setExamples([]));
  }, []);

  function startStream(text: string, baseSpec?: UISpec) {
    const p = text.trim();
    if (!p || busyRef.current) return;
    setBusy(true);
    setBuilding(true);
    setError(null);
    setShowSpec(false);
    if (!baseSpec) setSpec(null);

    streamSpec(
      { prompt: p, spec: baseSpec },
      {
        onMeta: (m) => {
          setSpec({ title: m.title ?? undefined, initialState: m.initialState, tree: [] });
          setCount(m.count);
          setGenId((n) => n + 1);
        },
        onNode: (n) => setSpec((s) => (s ? { ...s, tree: [...s.tree, n.node] } : { tree: [n.node] })),
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

  const voice = useVoice((text) => submitRefine(text));

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-10">
      {/* Header */}
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel/60 px-3 py-1 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" /> Generative UI Playground
        </span>
        <h1 className="mt-4 bg-gradient-to-r from-ink to-accent-soft bg-clip-text text-4xl font-bold text-transparent">
          Describe an interface. Watch it build itself.
        </h1>
        <p className="mt-3 text-muted">
          Type a sentence and a working, interactive UI is generated on the fly — then refine it by chat or voice.
        </p>
      </header>

      {/* Prompt */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitPrompt(prompt);
        }}
        className="flex gap-2"
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="a tip calculator that splits the bill…"
          className="flex-1 rounded-xl border border-edge bg-panel/70 px-4 py-3 text-ink placeholder:text-muted/70 outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-5 py-3 font-medium text-white transition-colors hover:bg-accent-deep disabled:opacity-50"
        >
          {busy ? 'Building…' : 'Generate'}
        </button>
      </form>

      {/* Example chips */}
      <div className="mt-3 flex flex-wrap gap-2">
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
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      <main className="mt-8 flex-1">
        {spec ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted">
                {spec.title ?? 'Generated UI'}
                {building && (
                  <span className="inline-flex items-center gap-1 text-accent-soft">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
                    building {spec.tree.length}/{count}
                  </span>
                )}
              </h2>
              {!building && (
                <button
                  onClick={() => setShowSpec((s) => !s)}
                  className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {showSpec ? 'Hide spec' : 'View spec'}
                </button>
              )}
            </div>

            <GeneratedApp key={genId} spec={spec} />

            {/* Refinement bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitRefine(refineText);
              }}
              className="mt-4 flex items-center gap-2 rounded-xl border border-edge bg-panel/60 p-2"
            >
              <span className="pl-2 text-xs text-muted">Refine</span>
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="make it dark · add a reset button · turn it into a bar chart…"
                disabled={busy}
                className="flex-1 bg-transparent px-1 py-1.5 text-sm text-ink placeholder:text-muted/60 outline-none disabled:opacity-50"
              />
              {voice.supported && (
                <button
                  type="button"
                  onClick={voice.start}
                  title="Speak a refinement"
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${voice.listening ? 'border-accent bg-accent/15 text-accent-soft' : 'border-edge text-muted hover:text-ink'}`}
                >
                  {voice.listening ? '● listening' : '🎤'}
                </button>
              )}
              <button
                type="submit"
                disabled={busy || !refineText.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-deep disabled:opacity-40"
              >
                Send
              </button>
            </form>

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
    </div>
  );
};

const Gallery: React.FC<{ examples: Example[]; onPick: (ex: Example) => void }> = ({ examples, onPick }) => (
  <div>
    <p className="mb-4 text-center text-sm text-muted">…or start from an example</p>
    <div className="grid gap-4 sm:grid-cols-3">
      {examples.map((ex) => (
        <button
          key={ex.id}
          onClick={() => onPick(ex)}
          className="rounded-2xl border border-edge bg-panel/50 p-5 text-left transition-colors hover:border-accent"
        >
          <h3 className="font-semibold text-ink">{ex.title}</h3>
          <p className="mt-1 text-xs text-muted">{ex.blurb}</p>
        </button>
      ))}
    </div>
  </div>
);
