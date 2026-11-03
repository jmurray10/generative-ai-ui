import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Example, UIDesign, UINode, UISpec } from '../shared/spec';
import type { ChatTurn, UIActResult } from '../shared/control';
import type { DecisionEnvelope } from '../shared/toolbox';
import { chat, decide, fetchExamples, streamSpec } from './api';
import { GeneratedApp } from './engine/GeneratedApp';
import { controlHub } from './engine/control';
import { digestDomControls } from './engine/snapshot';
import { useLiveVoice } from './voice/useLiveVoice';
import { Landing } from './shell/Landing';
import { Conversation, type DecisionState, type Entry } from './shell/Conversation';

const SURPRISE_PROMPTS = [
  'a pixel-art paint program with a palette, brush sizes, fill and undo',
  'a generative flow-field art studio with sliders for noise, density and color, and export to PNG',
  'a recipe for shakshuka with a servings scaler, a step-by-step cooking mode and timers',
  'a habit tracker heatmap for the year with streaks and a weekly goal',
  'a breakout game with power-ups, lives and a level counter',
  'a world clock board for 6 cities with a meeting-time finder',
  'a synth keyboard with waveform, attack and release controls using the Web Audio API',
  'a periodic table explorer: click an element to see its properties, filter by group',
];

const GENERIC_TRY = ['What is on screen right now?', 'Make it feel more premium', 'Add a reset button'];

type Prov = { kind: 'generate' | 'refine'; text: string; source: string } | null;

interface BackendHealth {
  generator: string;
  model?: string | null;
  voice: string;
  decider?: string;
}

interface Routing {
  lane?: string;
  components?: string[];
  style?: string;
}

/** Flatten a node's subtree into readable build-log entries (DFS). */
function logEntries(node: UINode): { type: string; label: string }[] {
  const label = (node.props?.title as string) || (node.props?.label as string) || (node.props?.stateKey as string) || '';
  const here = { type: node.type, label: typeof label === 'string' ? label : '' };
  return [here, ...(node.children ?? []).flatMap(logEntries)];
}

function routingFrom(env: DecisionEnvelope): Routing | undefined {
  const d = env.decision;
  return d.kind === 'route' ? { lane: d.renderMode, components: d.components, style: d.designSystem } : undefined;
}

function describeResult(r: UIActResult): string {
  const [verb, target] = [r.action.split(':')[0], r.action.slice(r.action.indexOf(':') + 1)];
  if (!r.ok) return `${verb} ${target} failed${r.detail ? `: ${r.detail}` : ''}`;
  if (verb === 'call') return `${target}()${r.detail ? ` → ${r.detail}` : ''}`;
  return r.detail ?? `${verb} ${target}`;
}

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never;

let entryId = 0;
const nextId = () => ++entryId;

export const App: React.FC = () => {
  const [examples, setExamples] = useState<Example[]>([]);
  const [backend, setBackend] = useState<BackendHealth>({ generator: 'stub', voice: 'off' });
  const [prompt, setPrompt] = useState('');
  const [spec, setSpec] = useState<UISpec | null>(null);
  const [genId, setGenId] = useState(0);
  const [building, setBuilding] = useState(false);
  const [count, setCount] = useState(0);
  const [log, setLog] = useState<{ type: string; label: string }[]>([]);
  const [prov, setProv] = useState<Prov>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [decision, setDecision] = useState<DecisionState>({ status: 'idle' });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [example, setExample] = useState<Example | null>(null);
  const [started, setStarted] = useState(false);

  const specRef = useRef<UISpec | null>(null);
  specRef.current = spec;
  const abortRef = useRef<AbortController | null>(null);
  const lastRun = useRef<() => void>(() => {});
  const pendingPrompt = useRef('');

  useEffect(() => {
    fetchExamples().then(setExamples).catch(() => setExamples([]));
    fetch('/api/health')
      .then((res) => res.json())
      .then((b: BackendHealth) => setBackend(b))
      .catch(() => {});
  }, []);

  const push = useCallback((e: NewEntry) => setEntries((list) => [...list, { ...e, id: nextId() } as Entry]), []);

  const voiceName = backend.voice === 'grok' ? 'Grok' : backend.voice === 'gemini' ? 'Gemini' : null;
  const busy = building || decision.status === 'deciding';

  // ---- what chat and voice read ------------------------------------------
  const screenContext = useCallback(() => {
    const root = document.querySelector('section[aria-label="Generated interface"]');
    let readable = root ? (root as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : '';
    if (root) {
      const controls = digestDomControls(root);
      if (controls) readable = (readable ? readable + ' · ' : '') + controls;
    }
    // Sandboxed lanes are cross-origin; each iframe posts a text digest we stash on the element.
    const iframeText = Array.from(document.querySelectorAll<HTMLElement>('iframe[data-artifact-text]'))
      .map((el) => el.dataset.artifactText || '')
      .filter(Boolean)
      .join(' · ');
    if (iframeText) readable = (readable ? readable + ' · ' : '') + iframeText;
    const s = specRef.current;
    if (s && !readable) readable = (s.title ? s.title + '. ' : '') + 'An interactive app is shown (rendered in a sandbox).';
    else if (s?.title) readable = s.title + '. ' + readable;
    return { spec: s, readable };
  }, []);

  const applySpec = useCallback((s: UISpec, source: string, text: string) => {
    setProv({ kind: 'refine', text, source });
    setSpec(s);
    setCount(s.tree.length);
    setGenId((n) => n + 1);
  }, []);

  // ---- voice ----------------------------------------------------------------
  const voice = useLiveVoice({
    getContext: screenContext,
    onSpec: (s) => {
      applySpec(s, backend.voice, 'voice');
      push({ kind: 'event', text: 'Rebuilt the interface' });
    },
    onActs: (results) => results.forEach((r) => push({ kind: 'event', text: describeResult(r), ok: r.ok })),
    onTool: (name) => {
      if (name === 'refine_ui' || name === 'generate_ui') push({ kind: 'event', text: name === 'refine_ui' ? 'Refining the design…' : 'Generating a new UI…' });
    },
  });
  const voiceLive = voice.status === 'live' || voice.status === 'connecting';

  // Keep the voice agent's context fresh when the UI changes out-of-band.
  useEffect(() => {
    if (voiceLive) voice.updateContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genId]);

  // Archive a voice session's final lines into the thread when it ends.
  const stopVoice = useCallback(() => {
    const finals = voice.transcripts.filter((t) => !t.partial && t.text.trim());
    setEntries((list) => [
      ...list,
      ...finals.map((t) => ({ id: nextId(), kind: t.who === 'ai' ? 'assistant' : 'user', text: t.text, via: 'voice' }) as Entry),
    ]);
    voice.stop();
  }, [voice]);

  // Test/demo hooks: drive voice or the control hub without a mic.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__voiceText = voice.sendText;
    w.__genui = { controls: () => controlHub.controls(), run: controlHub.run.bind(controlHub) };
  }, [voice.sendText]);

  // ---- build: route with Jev, then stream ----------------------------------
  const startStream = useCallback((text: string, routing?: Routing) => {
    abortRef.current?.abort();
    lastRun.current = () => startStream(text, routing);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBuilding(true);
    setError(null);
    setShowSpec(false);
    setLog([]);
    setNotices([]);
    setSpec(null);

    streamSpec(
      { prompt: text, ...routing },
      {
        onMeta: (m) => {
          const source = m.degraded ? (m.source === 'stub' ? 'stub' : 'degraded') : m.source;
          setProv({ kind: 'generate', text, source });
          setNotices(Array.isArray(m.notices) ? m.notices : []);
          const design = (m as { design?: UIDesign | null }).design ?? undefined;
          setSpec({ title: m.title ?? undefined, initialState: m.initialState, ...(design ? { design } : {}), tree: [] });
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
          if (d.spec.title) push({ kind: 'event', text: `Built “${d.spec.title}”${d.spec.design?.direction ? ` · ${d.spec.design.direction}` : ''}` });
        },
        onError: (e) => {
          setError(e);
          setBuilding(false);
        },
      },
      ctrl.signal,
    ).catch((e) => {
      setError(String(e));
      setBuilding(false);
    });
  }, [push]);

  const routeThenBuild = useCallback(async (text: string, answered: boolean) => {
    setDecision({ status: 'deciding', prompt: text });
    try {
      const env = await decide(text, answered);
      setDecision({ status: 'done', envelope: env });
      const d = env.decision;
      if (d.kind === 'route') return startStream(text, routingFrom(env));
      if (d.kind === 'ask') return; // the decision card asks; build continues on answer/skip
      if (d.reason === 'unsafe_or_injection' || d.reason === 'contradictory') return; // hard hold
      startStream(text); // low confidence / router error: let the model choose the tools
    } catch (e) {
      setDecision({ status: 'failed', error: (e as Error).message });
      startStream(text);
    }
  }, [startStream]);

  const build = useCallback((text: string, ex?: Example) => {
    const p = text.trim();
    if (!p) return;
    abortRef.current?.abort();
    if (voiceLive) stopVoice();
    setPrompt(p);
    setStarted(true);
    setExample(ex ?? null);
    setEntries([]);
    setSpec(null);
    setBuilding(false);
    pendingPrompt.current = p;
    // Curated prompts are specific; let Jev route or hold, never ask.
    void routeThenBuild(p, Boolean(ex));
  }, [routeThenBuild, voiceLive, stopVoice]);

  const answerJev = (answer: string) => {
    const p = `${pendingPrompt.current}\nAudience: ${answer}`;
    pendingPrompt.current = p;
    push({ kind: 'user', text: answer, via: 'chat' });
    void routeThenBuild(p, true);
  };
  const skipJev = () => {
    setDecision((s) => (s.status === 'done' ? { ...s, skipped: true } : s));
    startStream(pendingPrompt.current);
  };

  const stop = () => {
    abortRef.current?.abort();
    setBuilding(false);
  };

  const surpriseIdx = useRef(Math.floor(Math.random() * SURPRISE_PROMPTS.length));
  const surprise = () => {
    surpriseIdx.current = (surpriseIdx.current + 1) % SURPRISE_PROMPTS.length;
    build(SURPRISE_PROMPTS[surpriseIdx.current]);
  };

  const reset = () => {
    abortRef.current?.abort();
    if (voiceLive) stopVoice();
    setStarted(false);
    setSpec(null);
    setBuilding(false);
    setDecision({ status: 'idle' });
    setEntries([]);
    setExample(null);
    setPrompt('');
  };

  // ---- chat: answer, operate, or rebuild -------------------------------------
  const send = async (text: string) => {
    if (!specRef.current) return;
    if (voiceLive) {
      // One conversation: while voice is on, typed messages go to the voice agent, which answers aloud.
      push({ kind: 'user', text, via: 'chat' });
      voice.sendText(text);
      return;
    }
    push({ kind: 'user', text, via: 'chat' });
    setChatBusy(true);
    const history: ChatTurn[] = entries
      .filter((e): e is Extract<Entry, { kind: 'user' | 'assistant' }> => e.kind === 'user' || e.kind === 'assistant')
      .slice(-8)
      .map((e) => ({ role: e.kind, text: e.text }));
    try {
      const { readable } = screenContext();
      const r = await chat({ message: text, spec: specRef.current, readable, controls: controlHub.controls(), history });
      if (r.spec) {
        applySpec(r.spec, backend.generator, text);
        push({ kind: 'event', text: r.change === 'generate' ? 'Generated a new interface' : 'Rebuilt the interface' });
      } else if (r.acts.length) {
        const results = await controlHub.run(r.acts);
        results.forEach((res) => push({ kind: 'event', text: describeResult(res), ok: res.ok }));
      }
      push({ kind: 'assistant', text: r.reply, via: 'chat', ok: r.ok });
    } catch (e) {
      push({ kind: 'error', text: (e as Error).message || 'The model did not answer.' });
    } finally {
      setChatBusy(false);
    }
  };

  const toggleVoice = () => {
    if (voiceLive) stopVoice();
    else void voice.start();
  };

  const suggestions = spec && !building ? (example?.tryIt ?? GENERIC_TRY) : [];

  return (
    <div className="grain relative min-h-screen">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[36rem] ${started ? 'opacity-40' : ''} shell-glow transition-opacity`} aria-hidden />
      <header className="sticky top-0 z-30 border-b border-edge/60 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-4 px-5">
          <button type="button" onClick={reset} className="flex items-center gap-2 text-ink" aria-label="GenUI Playground — start over">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent font-display text-base leading-none text-accent-ink">g</span>
            <span className="font-medium tracking-tight">genui <span className="text-muted">playground</span></span>
          </button>
          {started && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                build(prompt);
              }}
              className="mx-auto hidden w-full max-w-xl items-center gap-2 rounded-xl border border-edge bg-panel/70 px-1.5 py-1 focus-within:border-accent/60 md:flex"
            >
              <label htmlFor="top-prompt" className="sr-only">Describe an interface to generate</label>
              <input
                id="top-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe another interface…"
                className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-ink placeholder:text-muted/60 outline-none"
              />
              {busy ? (
                <button type="button" onClick={stop} className="rounded-lg px-3 py-1 text-sm text-muted hover:text-ink">Stop</button>
              ) : (
                <button type="submit" disabled={!prompt.trim()} className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-accent-ink disabled:opacity-40">Build</button>
              )}
            </form>
          )}
          <nav className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="hidden items-center gap-1.5 lg:flex" title="Models in use">
              <span className={`h-1.5 w-1.5 rounded-full ${backend.generator === 'stub' ? 'bg-amber-300' : 'bg-emerald-400'}`} />
              {backend.generator === 'stub' ? 'offline' : `${backend.model ?? backend.generator}`}
              {backend.decider && backend.decider !== 'none' && <span className="text-muted/70">· router {backend.decider === 'jev' ? 'Jev' : 'Grok judge'}</span>}
            </span>
            <a href="/docs" className="hover:text-ink">API</a>
            <a href="https://github.com/jmurray10/generative-ai-ui" className="hover:text-ink">GitHub</a>
          </nav>
        </div>
      </header>

      {!started ? (
        <Landing examples={examples} prompt={prompt} setPrompt={setPrompt} onBuild={build} onSurprise={surprise} generatorReady={backend.generator !== 'stub'} />
      ) : (
        <div className="relative mx-auto grid max-w-[90rem] gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <main aria-busy={busy} className="min-w-0">
            <p className="sr-only" role="status" aria-live="polite">
              {decision.status === 'deciding' ? 'Choosing tools…' : building ? 'Generating interface…' : spec ? `Interface ready: ${spec.title ?? 'Generated UI'}.` : ''}
            </p>

            {error && (
              <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                <span>Generation failed — the model may be busy. Please try again.</span>
                <button type="button" onClick={() => lastRun.current()} className="rounded border border-red-400/40 px-2 py-0.5 text-xs hover:bg-red-500/20">Retry</button>
              </div>
            )}

            {spec ? (
              <div>
                <CanvasHeader spec={spec} prov={prov} building={building} showSpec={showSpec} onToggleSpec={() => setShowSpec((v) => !v)} />
                {building && <BuildProgress have={spec.tree.length} count={count} log={log} />}
                {notices.length > 0 && <p className="mb-3 text-xs text-amber-200" role="status">{notices.join(' ')}</p>}
                <GeneratedApp key={genId} spec={spec} />
                {showSpec && (
                  <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-edge bg-panel p-4 font-mono text-xs text-muted">{JSON.stringify(spec, null, 2)}</pre>
                )}
              </div>
            ) : (
              <Waiting prompt={pendingPrompt.current} decision={decision} building={building} />
            )}
          </main>

          <Conversation
            decision={decision}
            onAnswer={answerJev}
            onSkip={skipJev}
            entries={entries}
            transcripts={voiceLive || voice.status === 'error' ? voice.transcripts : []}
            suggestions={suggestions}
            busy={chatBusy}
            canChat={Boolean(spec) && !building}
            onSend={(t) => void send(t)}
            voiceName={voiceName}
            voiceStatus={voice.status}
            voiceError={voice.error}
            micOk={voice.micOk}
            onToggleVoice={toggleVoice}
          />
        </div>
      )}

      {!started && (
        <footer className="mx-auto max-w-6xl px-5 pb-10 text-center text-xs text-muted">
          A demo of how generative UI can be built — every interface is generated live; nothing here is hard-coded.
        </footer>
      )}
    </div>
  );
};

const Waiting: React.FC<{ prompt: string; decision: DecisionState; building: boolean }> = ({ prompt, decision, building }) => {
  const asking = decision.status === 'done' && decision.envelope.decision.kind === 'ask' && !decision.skipped && !building;
  const held = decision.status === 'done' && decision.envelope.decision.kind === 'hold' && !building;
  return (
    <div className="rounded-2xl border border-edge bg-panel/50 p-6">
      <p className="text-sm text-muted">
        {asking ? 'One question before building' : held ? 'Not building this one' : building ? 'Designing and building' : 'Choosing the tools'}
      </p>
      <p className="mt-1 font-display text-2xl leading-snug text-ink">“{prompt}”</p>
      {asking ? (
        <p className="mt-4 text-sm text-muted">Answer in the panel, or choose “Just build it”.</p>
      ) : held ? (
        <p className="mt-4 text-sm text-muted">See the toolbox decision for why.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {[78, 56, 68, 40].map((w, i) => <div key={i} className="h-3.5 animate-pulse rounded bg-edge/70" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />)}
        </div>
      )}
    </div>
  );
};

const CanvasHeader: React.FC<{ spec: UISpec; prov: Prov; building: boolean; showSpec: boolean; onToggleSpec: () => void }> = ({ spec, prov, building, showSpec, onToggleSpec }) => {
  const d = spec.design;
  const label =
    prov?.source === 'degraded' ? 'Model did not return a UI'
      : prov?.kind === 'refine' ? 'Refined'
        : prov?.source === 'grok' ? 'Generated by Grok'
          : prov?.source === 'gemini' ? 'Generated by Gemini'
            : 'Offline — connect a model';
  return (
    <div className="mb-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            <span className="text-accent-soft">{label}</span>
            {prov?.text && prov.text !== 'voice' && <> · <span className="truncate">“{prov.text.length > 90 ? prov.text.slice(0, 90) + '…' : prov.text}”</span></>}
            {prov?.text === 'voice' && <> · by voice</>}
          </p>
          <h1 className="mt-1 truncate font-display text-3xl text-ink">{spec.title ?? 'Generated UI'}</h1>
        </div>
        {!building && spec.tree.length > 0 && (
          <button type="button" onClick={onToggleSpec} aria-expanded={showSpec} className="shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs text-muted hover:text-ink">
            {showSpec ? 'Hide spec' : 'View spec'}
          </button>
        )}
      </div>
      {d && (d.direction || d.palette?.length) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-edge py-2 text-xs text-muted" aria-label="Design brief">
          {d.direction && <span><span className="text-muted/70">Direction</span> <span className="text-ink">{d.direction}</span></span>}
          {d.fonts && <span><span className="text-muted/70">Type</span> <span className="text-ink">{d.fonts}</span></span>}
          {d.palette && d.palette.length > 0 && (
            <span className="flex items-center gap-1" aria-label={`Palette ${d.palette.join(', ')}`}>
              {d.palette.map((c) => <span key={c} title={c} className="h-3.5 w-3.5 rounded-sm border border-white/10" style={{ background: c }} />)}
            </span>
          )}
          {d.signature && <span className="basis-full text-muted sm:basis-auto"><span className="text-muted/70">Signature</span> {d.signature}</span>}
        </div>
      )}
    </div>
  );
};

const BuildProgress: React.FC<{ have: number; count: number; log: { type: string; label: string }[] }> = ({ have, count, log }) => (
  <div className="mb-4 rounded-xl border border-edge bg-panel/50 p-3">
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-accent-soft">
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
        Assembling the interface…
      </span>
      <span className="font-mono text-muted tabular">{have}/{Math.max(have, count)}</span>
    </div>
    <div className="h-1 w-full overflow-hidden rounded-full bg-edge" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(have, count)} aria-valuenow={have} aria-label="Assembly progress">
      <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${count ? Math.min(100, (have / count) * 100) : 0}%` }} />
    </div>
    <div className="mt-2 max-h-28 overflow-hidden font-mono text-[11px] leading-relaxed">
      {log.slice(-7).map((e, i) => {
        const sandboxed = e.type === 'CustomWidget' || e.type === 'ReactArtifact';
        return (
          <div key={i} className="animate-rise">
            <span className={sandboxed ? 'text-amber-300' : 'text-accent'}>+</span> <span className="text-muted">{e.type}</span>
            {e.label ? <span className="text-muted/70"> “{e.label}”</span> : null}
            <span className={`ml-1 rounded px-1 text-[10px] ${sandboxed ? 'bg-amber-500/15 text-amber-300' : 'bg-accent/10 text-accent-soft'}`}>
              {e.type === 'ReactArtifact' ? 'React sandbox' : sandboxed ? 'JS sandbox' : 'registry'}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);
