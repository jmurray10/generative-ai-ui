import React, { useEffect, useRef } from 'react';
import type { Example } from '../../shared/spec';

const LANE_LABEL: Record<NonNullable<Example['lane']>, string> = {
  registry: 'Registry + state',
  react: 'React sandbox',
  sandbox: 'JS sandbox',
};

/** Small line drawings, one per example — a hint of the subject, not a screenshot. */
const Glyph: React.FC<{ id: string }> = ({ id }) => {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'trading':
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          {[[10, 30, 18, 40], [24, 22, 14, 34], [38, 26, 20, 40], [52, 14, 12, 28], [66, 18, 16, 30], [80, 8, 12, 22], [94, 12, 14, 26], [108, 4, 10, 18]].map(([x, top, h, wick], i) => (
            <g key={i} className={i % 3 === 1 ? 'text-muted' : 'text-accent'}>
              <line x1={x} x2={x} y1={top - 4} y2={wick + 8} {...common} strokeWidth={1} />
              <rect x={x - 3} y={top} width={6} height={h} rx={1} fill="currentColor" stroke="none" />
            </g>
          ))}
        </svg>
      );
    case 'solar':
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          <circle cx="60" cy="28" r="6" fill="currentColor" className="text-accent" />
          <ellipse cx="60" cy="28" rx="22" ry="9" {...common} className="text-muted" />
          <ellipse cx="60" cy="28" rx="40" ry="16" {...common} className="text-muted" />
          <ellipse cx="60" cy="28" rx="56" ry="24" {...common} className="text-muted" strokeDasharray="2 4" />
          <circle cx="82" cy="28" r="2.5" fill="currentColor" className="text-ink" />
          <circle cx="30" cy="20" r="3.5" fill="currentColor" className="text-ink" />
        </svg>
      );
    case 'drums':
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          {Array.from({ length: 4 }).flatMap((_, r) =>
            Array.from({ length: 16 }).map((__, c) => {
              const on = (r === 0 && c % 4 === 0) || (r === 1 && c % 8 === 4) || (r === 2 && c % 2 === 0) || (r === 3 && c === 12);
              return <rect key={`${r}-${c}`} x={4 + c * 7} y={6 + r * 12} width={5} height={8} rx={1} fill="currentColor" className={on ? 'text-accent' : 'text-edge'} />;
            }),
          )}
        </svg>
      );
    case 'mortgage':
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          <path d="M14 30 L34 14 L54 30 V48 H14 Z" {...common} className="text-ink" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <line x1="66" x2="112" y1={16 + i * 14} y2={16 + i * 14} {...common} className="text-edge" />
              <circle cx={[90, 76, 100][i]} cy={16 + i * 14} r="3.5" fill="currentColor" className="text-accent" />
            </g>
          ))}
        </svg>
      );
    case 'incidents':
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <circle cx="10" cy={10 + i * 12} r="3" fill="currentColor" className={i === 0 ? 'text-accent' : i === 2 ? 'text-amber-300' : 'text-muted'} />
              <line x1="18" x2={64 - i * 6} y1={10 + i * 12} y2={10 + i * 12} {...common} className="text-ink" />
            </g>
          ))}
          <rect x="78" y="4" width="38" height="48" rx="3" {...common} className="text-edge" />
          <line x1="84" x2="108" y1="14" y2="14" {...common} className="text-muted" />
          <line x1="84" x2="100" y1="22" y2="22" {...common} className="text-muted" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 120 56" aria-hidden className="h-14 w-full">
          <path d="M16 40 H52 V22 H76 V34 H96" {...common} strokeWidth={6} className="text-accent" />
          <circle cx="108" cy="16" r="4" fill="currentColor" className="text-ink" />
        </svg>
      );
  }
};

interface Props {
  examples: Example[];
  prompt: string;
  setPrompt: (v: string) => void;
  onBuild: (prompt: string, example?: Example) => void;
  onSurprise: () => void;
  generatorReady: boolean;
  /** Name of the voice agent, or null when voice is off. */
  voiceName: string | null;
  /** Start a voice session and describe the UI out loud. */
  onTalk: () => void;
}

export const Landing: React.FC<Props> = ({ examples, prompt, setPrompt, onBuild, onSurprise, generatorReady, voiceName, onTalk }) => {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Desktop only: on phones autofocus pops the keyboard over the page.
    if (window.matchMedia('(min-width: 768px)').matches) box.current?.focus();
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-20">
      <section className="mx-auto max-w-3xl pt-14 text-center sm:pt-20">
        <h1 className="text-balance font-display text-5xl leading-[1.02] tracking-tight text-ink sm:text-7xl">
          Describe an interface.
          <br />
          <em className="text-accent-soft">Then talk to it.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
          Grok builds a working UI from one sentence and Jev picks the right tools for it. Then you chat or
          speak, and the agent <span className="text-ink">operates</span> the UI for you instead of rebuilding it.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onBuild(prompt);
          }}
          className="mt-10 rounded-2xl border border-edge bg-panel/80 p-2 text-left shadow-[0_24px_80px_-32px_rgb(0_0_0/0.8)] transition-colors focus-within:border-accent/60"
        >
          <label htmlFor="prompt" className="sr-only">
            Describe an interface to generate
          </label>
          <textarea
            id="prompt"
            ref={box}
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onBuild(prompt);
              }
            }}
            placeholder="A home affordability planner where I can drag the rate and see the payment…"
            className="block w-full resize-none bg-transparent px-3 py-3 text-base leading-snug sm:text-lg text-ink placeholder:text-muted/60 outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <button
              type="button"
              onClick={onSurprise}
              className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-edge/50 hover:text-ink"
            >
              Surprise me
            </button>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted/70 sm:inline">
                <kbd className="font-mono">Enter</kbd> to build
              </span>
              {voiceName && generatorReady && (
                <button
                  type="button"
                  onClick={onTalk}
                  title={`Describe it out loud — ${voiceName} builds it`}
                  className="flex items-center gap-1.5 rounded-xl border border-edge px-3 py-2.5 text-sm text-muted transition-colors hover:border-accent/60 hover:text-ink"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                  Say it
                </button>
              )}
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="rounded-xl bg-accent px-5 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                Build it
              </button>
            </div>
          </div>
        </form>
        {!generatorReady && (
          <p className="mt-3 text-sm text-amber-200" role="status">
            No model key is configured, so builds will show a notice. Set <code className="font-mono">XAI_API_KEY</code> to generate.
          </p>
        )}
      </section>

      <ol className="mx-auto mt-16 grid max-w-5xl gap-px overflow-hidden rounded-2xl border border-edge bg-edge sm:grid-cols-3">
        {[
          ['Route', 'Jev reads the prompt and picks the lane, the pieces it needs, and whether to ask you something first.'],
          ['Design & build', 'Grok commits to a design brief — direction, type, palette, one signature moment — then streams the UI in.'],
          ['Operate', 'Chat or talk to it. “Set the rate to 6%.” “Fly to Saturn.” The agent drives the controls in place.'],
        ].map(([t, d], i) => (
          <li key={t} className="bg-canvas p-5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-accent tabular">0{i + 1}</span>
              <h2 className="font-medium text-ink">{t}</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
          </li>
        ))}
      </ol>

      <section className="mt-16" aria-labelledby="gallery-title">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 id="gallery-title" className="font-display text-3xl text-ink">
            Start from something hard
          </h2>
          <p className="hidden max-w-xs text-right text-sm text-muted sm:block">Every card is just a prompt. Nothing is pre-built.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {examples.map((ex) => (
            <button
              type="button"
              key={ex.id}
              onClick={() => onBuild(ex.prompt, ex)}
              className="group flex flex-col rounded-2xl border border-edge bg-panel/60 p-5 text-left transition-[transform,border-color,background-color] duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-panel"
            >
              <div className="text-muted transition-colors group-hover:text-ink">
                <Glyph id={ex.id} />
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <h3 className="text-lg font-medium text-ink">{ex.title}</h3>
                {ex.lane && <span className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 font-mono text-[10px] text-muted">{LANE_LABEL[ex.lane]}</span>}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{ex.blurb}</p>
              {ex.tryIt?.[0] && (
                <p className="mt-4 border-t border-edge pt-3 text-sm text-muted">
                  Then say <span className="text-accent-soft">“{ex.tryIt[0]}”</span>
                </p>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
