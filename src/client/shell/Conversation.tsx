import React, { useEffect, useRef, useState } from 'react';
import type { DecisionEnvelope } from '../../shared/toolbox';
import type { TranscriptLine } from '../voice/transcript';
import type { VoiceStatus } from '../voice/useLiveVoice';

export type Entry =
  | { id: number; kind: 'user'; text: string; via: 'chat' | 'voice' }
  | { id: number; kind: 'assistant'; text: string; via: 'chat' | 'voice'; ok?: boolean }
  | { id: number; kind: 'event'; text: string; ok?: boolean }
  | { id: number; kind: 'error'; text: string };

export type DecisionState =
  | { status: 'idle' }
  | { status: 'deciding'; prompt: string }
  | { status: 'done'; envelope: DecisionEnvelope; skipped?: boolean }
  | { status: 'failed'; error: string };

const SOURCE: Record<string, string> = { jev: 'Jev · TypeSafe', grok_fallback: 'Grok judge (Jev stand-in)', none: 'no router' };
const STYLE: Record<string, string> = { editorial_serif: 'Editorial', ops_console: 'Ops console', soft_consumer: 'Consumer' };
const LANE: Record<string, string> = { registry: 'Registry + state', sandboxed_react: 'React sandbox' };
const PIECE: Record<string, string> = { stepper: 'stepper', table: 'table', drawer: 'drawer', citation_viewer: 'citations', approval_card: 'approval' };
const HOLD: Record<string, string> = {
  unsafe_or_injection: 'Held: this prompt looks like it tries to override instructions or reach secrets.',
  contradictory: 'Held: the request contradicts itself. Rephrase it and try again.',
  low_confidence: "Jev wasn't confident about the tools, so the model chooses them.",
  jev_error: "The router didn't answer, so the model chooses the tools.",
};

const Chip: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => (
  <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${strong ? 'border-accent/40 text-accent-soft' : 'border-edge text-muted'}`}>{children}</span>
);

export const DecisionCard: React.FC<{
  state: DecisionState;
  onAnswer: (text: string) => void;
  onSkip: () => void;
}> = ({ state, onAnswer, onSkip }) => {
  const [answer, setAnswer] = useState('');
  const [why, setWhy] = useState(false);
  if (state.status === 'idle') return null;
  if (state.status === 'deciding') {
    return (
      <div className="rounded-xl border border-edge bg-canvas/60 p-3 text-sm" role="status">
        <div className="flex items-center gap-2 text-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Jev is choosing the tools…
        </div>
      </div>
    );
  }
  if (state.status === 'failed') {
    return <div className="rounded-xl border border-edge bg-canvas/60 p-3 text-xs text-muted">Router unavailable ({state.error}). The model chooses the tools.</div>;
  }
  const { envelope, skipped } = state;
  const d = envelope.decision;
  return (
    <div className="rounded-xl border border-edge bg-canvas/60 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">Toolbox decision</span>
        <span className="font-mono text-[10px] text-muted tabular">{envelope.ms} ms</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted">by {SOURCE[envelope.source] ?? envelope.source}</p>
      {d.kind === 'route' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip strong>{LANE[d.renderMode]}</Chip>
          <Chip>{STYLE[d.designSystem]} audience</Chip>
          {d.components.map((c) => <Chip key={c}>needs {PIECE[c]}</Chip>)}
        </div>
      )}
      {d.kind === 'ask' && !skipped && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) onAnswer(answer.trim());
          }}
        >
          <label htmlFor="jev-answer" className="text-ink">{d.prompt}</label>
          <div className="mt-2 flex gap-2">
            <input
              id="jev-answer"
              autoFocus
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <button type="submit" disabled={!answer.trim()} className="rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink disabled:opacity-40">Answer</button>
          </div>
          <button type="button" onClick={onSkip} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">Just build it</button>
        </form>
      )}
      {d.kind === 'ask' && skipped && <p className="mt-2 text-xs text-muted">Skipped the question; the model chooses the tools.</p>}
      {d.kind === 'hold' && (
        <p className={`mt-2 text-xs ${d.reason === 'unsafe_or_injection' || d.reason === 'contradictory' ? 'text-red-300' : 'text-muted'}`}>{HOLD[d.reason]}</p>
      )}
      {envelope.why.length > 0 && (
        <>
          <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="mt-2 text-xs text-muted hover:text-ink">
            {why ? 'Hide why' : 'Why these tools?'}
          </button>
          {why && (
            <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-muted">
              {envelope.why.map((w, i) => <li key={i}>· {w}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

const VOICE_STATUS: Record<VoiceStatus, string> = { idle: 'Voice off', connecting: 'Connecting…', live: 'Listening', error: 'Voice error' };

interface Props {
  decision: DecisionState;
  onAnswer: (text: string) => void;
  onSkip: () => void;
  entries: Entry[];
  transcripts: TranscriptLine[];
  suggestions: string[];
  busy: boolean;
  canChat: boolean;
  onSend: (text: string) => void;
  voiceName: string | null;
  voiceStatus: VoiceStatus;
  voiceError: string | null;
  micOk: boolean;
  onToggleVoice: () => void;
}

export const Conversation: React.FC<Props> = (p) => {
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [p.entries.length, p.transcripts.length]);

  const send = (t: string) => {
    const v = t.trim();
    if (!v) return;
    p.onSend(v);
    setText('');
  };
  const live = p.voiceStatus === 'live' || p.voiceStatus === 'connecting';

  return (
    <aside aria-label="Conversation" className="flex min-h-[28rem] flex-col rounded-2xl border border-edge bg-panel/70 lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
        <h2 className="font-medium text-ink">Talk to it</h2>
        {p.voiceName && (
          <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${p.voiceStatus === 'live' ? 'animate-pulse bg-emerald-400' : p.voiceStatus === 'error' ? 'bg-red-400' : 'bg-edge'}`} />
            {VOICE_STATUS[p.voiceStatus]}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 pt-3">
        <DecisionCard state={p.decision} onAnswer={p.onAnswer} onSkip={p.onSkip} />
      </div>

      <div ref={log} role="log" aria-live="polite" className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3 text-sm">
        {p.entries.length === 0 && p.transcripts.length === 0 && (
          <p className="text-muted">
            Ask about what's on screen, tell it what to do, or ask for a change. Chat and voice share the same tools.
          </p>
        )}
        {p.entries.map((e) => <Line key={e.id} e={e} voiceName={p.voiceName} />)}
        {p.transcripts.map((t, i) => (
          <div key={`t${i}`} className={t.who === 'ai' ? 'max-w-[90%] text-ink' : 'ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-edge/70 px-3 py-1.5 text-ink'}>
            {t.who === 'ai' && <span className="mr-1 text-xs text-accent-soft">{p.voiceName ?? 'Voice'}:</span>}
            <span className={t.partial ? 'opacity-70' : ''}>{t.text}</span>
            {t.who === 'user' && <span className="ml-1 text-[10px] text-muted">🎙</span>}
          </div>
        ))}
        {p.busy && (
          <div className="flex items-center gap-1 text-muted" aria-label="Thinking">
            {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}
          </div>
        )}
      </div>

      {p.voiceStatus === 'error' && p.voiceError && (
        <p className="mx-4 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">{p.voiceError}</p>
      )}
      {live && !p.micOk && <p className="mx-4 mb-2 text-xs text-amber-200">Mic blocked — type below and {p.voiceName ?? 'voice'} will answer aloud.</p>}

      {p.canChat && p.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {p.suggestions.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => send(s)}
              disabled={p.busy}
              className="rounded-full border border-edge px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/60 hover:text-ink disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="m-3 mt-1 flex items-end gap-2 rounded-xl border border-edge bg-canvas/70 p-1.5 focus-within:border-accent/60"
      >
        <label htmlFor="chat-input" className="sr-only">Message the interface</label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!p.canChat}
          placeholder={!p.canChat ? 'Build something first…' : live ? `Type and ${p.voiceName ?? 'voice'} answers aloud…` : 'Set the rate to 6% · make it dark · what is the total?'}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-muted/60 outline-none disabled:opacity-50"
        />
        {p.voiceName && (
          <button
            type="button"
            onClick={p.onToggleVoice}
            disabled={!p.canChat}
            aria-pressed={live}
            aria-label={live ? `Stop talking with ${p.voiceName}` : `Talk with ${p.voiceName}`}
            title={live ? 'Stop voice' : `Talk with ${p.voiceName}`}
            className={`grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40 ${live ? 'animate-flash bg-accent text-accent-ink' : 'text-muted hover:bg-edge/60 hover:text-ink'}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="submit" disabled={!p.canChat || !text.trim() || p.busy} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-soft disabled:opacity-40">
          Send
        </button>
      </form>
    </aside>
  );
};

const Line: React.FC<{ e: Entry; voiceName: string | null }> = ({ e, voiceName }) => {
  if (e.kind === 'user') {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-edge/70 px-3 py-1.5 text-ink">
        {e.text}
        {e.via === 'voice' && <span className="ml-1 text-[10px] text-muted">🎙</span>}
      </div>
    );
  }
  if (e.kind === 'assistant') {
    return (
      <div className={`max-w-[92%] ${e.ok === false ? 'text-amber-200' : 'text-ink'}`}>
        {e.via === 'voice' && <span className="mr-1 text-xs text-accent-soft">{voiceName ?? 'Voice'}:</span>}
        {e.text}
      </div>
    );
  }
  if (e.kind === 'event') {
    return (
      <div className={`flex items-start gap-2 font-mono text-[11px] ${e.ok === false ? 'text-amber-200' : 'text-muted'}`}>
        <span className={e.ok === false ? 'text-amber-300' : 'text-accent'}>{e.ok === false ? '!' : '→'}</span>
        <span>{e.text}</span>
      </div>
    );
  }
  return <div role="alert" className="text-xs text-red-300">{e.text}</div>;
};
