import React, { useEffect, useRef, useState } from 'react';
import { useLiveVoice } from './useLiveVoice';
import type { UISpec } from '../../shared/spec';

interface Props {
  providerLabel: string;
  getContext: () => { spec: UISpec | null; readable: string };
  onSpec: (s: UISpec) => void;
  specVersion: number;
  onClose: () => void;
  /** Starter commands; defaults to the playground's. */
  starters?: string[];
}

const statusLabel: Record<string, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  live: 'Listening',
  error: 'Error',
};

export const VoicePanel: React.FC<Props> = ({ providerLabel, getContext, onSpec, specVersion, onClose, starters = ['Read me the data', 'Make it dark', 'Add a reset button'] }) => {
  const voice = useLiveVoice({ getContext, onSpec });
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    voice.start();
    const prevFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus(); // move focus into the dialog on open
    return () => { voice.stop(); prevFocus?.focus?.(); }; // …and back to the trigger on close
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the agent's server-side context fresh when the UI changes out-of-band
  useEffect(() => {
    voice.updateContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specVersion]);

  // test/demo hook: trigger a command without a microphone
  useEffect(() => {
    (window as unknown as { __voiceText?: (t: string) => void }).__voiceText = voice.sendText;
  }, [voice.sendText]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    voice.sendText(t);
    setText('');
  };

  const dotClass = voice.status === 'live'
    ? 'animate-pulse bg-ok'
    : voice.status === 'error'
      ? 'bg-bad'
      : 'bg-accent';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${providerLabel} assistant`}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed bottom-4 left-4 right-4 z-40 max-h-[70vh] overflow-hidden rounded-2xl border border-edge bg-panel/95 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:left-auto sm:w-80"
    >
      <div className="mb-2 flex items-center justify-between">
        <span role="status" className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          {providerLabel} · {statusLabel[voice.status]}
        </span>
        <button type="button" onClick={onClose} aria-label="Close voice" className="rounded px-1 text-xs text-muted hover:text-ink">✕</button>
      </div>

      {voice.status === 'error' ? (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-bad/40 bg-bad/10 px-2 py-1.5 text-[11px] text-ink">
          <span>{voice.error ?? 'Voice disconnected.'}</span>
          <button type="button" onClick={() => voice.start()} className="rounded border border-bad/50 px-1.5 py-0.5 hover:bg-bad/20">Reconnect</button>
        </div>
      ) : (
        <p className="mb-2 text-[11px] text-muted" aria-live="polite">
          {voice.micOk
            ? `Speak or type — “read me the total”, “make it dark”, “change the tip to 25 percent”. ${providerLabel} answers in its own voice and updates the screen.`
            : '🔇 Mic blocked — type your command below. (Allow the mic to talk to it.)'}
        </p>
      )}

      {/* contextual starter commands */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {starters.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => voice.sendText(c)}
            className="rounded-full border border-edge bg-canvas/50 px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-ink"
          >
            {c}
          </button>
        ))}
      </div>

      <div role="log" aria-live="polite" aria-atomic="false" className="mb-2 max-h-32 space-y-1 overflow-y-auto text-xs">
        {voice.transcripts.length === 0 ? (
          <div className="text-muted">
            {voice.status === 'error'
              ? 'Voice is unavailable.'
              : voice.status === 'live'
                ? (voice.micOk ? 'Listening…' : 'Ready — type a command.')
                : `Connecting to ${providerLabel}…`}
          </div>
        ) : (
          voice.transcripts.map((t, i) => (
            <div key={i} className={t.who === 'ai' ? 'text-accent-soft' : 'text-muted'}>
              <span className="opacity-60">{t.who === 'ai' ? providerLabel : 'You'}:</span> {t.text}
            </div>
          ))
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="type a command…"
          aria-label="Type a voice command"
          className="flex-1 rounded-lg border border-edge bg-canvas/60 px-2 py-1.5 text-xs text-ink placeholder:text-muted/60 outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-deep">Send</button>
      </form>
    </div>
  );
};
