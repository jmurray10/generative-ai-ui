import { useCallback, useRef, useState } from 'react';
import { AudioPlayer, MicStreamer } from './audio';
import { applyTranscript, type TranscriptLine } from './transcript';
import type { UISpec } from '../../shared/spec';

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error';
export type Transcript = TranscriptLine;

interface Opts {
  getContext: () => { spec: UISpec | null; readable: string };
  onSpec: (s: UISpec) => void;
}

/**
 * Client side of the realtime voice session: opens the /voice WebSocket,
 * streams mic audio up, plays the model's audio down, surfaces transcripts, and
 * applies spec updates the model makes via tools.
 */
export function useLiveVoice(opts: Opts) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [micOk, setMicOk] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicStreamer | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    try { micRef.current?.stop(); } catch { /* */ }
    try { playerRef.current?.close(); } catch { /* */ }
    try { wsRef.current?.close(); } catch { /* */ }
    micRef.current = null;
    playerRef.current = null;
    wsRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setStatus('connecting');
    setError(null);
    setTranscripts([]);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/voice`);
    wsRef.current = ws;
    const player = new AudioPlayer();
    playerRef.current = player;
    player.resume();

    ws.onopen = () => {
      const { spec, readable } = optsRef.current.getContext();
      ws.send(JSON.stringify({ type: 'init', spec, readable }));
    };
    ws.onclose = () => { if (wsRef.current === ws) stop(); };
    ws.onerror = () => setStatus('error');
    ws.onmessage = async (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'ready' || m.type === 'connected') {
        setStatus('live');
        if (!micRef.current) {
          const mic = new MicStreamer();
          micRef.current = mic;
          try {
            await mic.start((b64) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'audio', audio: b64 })); });
            setMicOk(true);
          } catch {
            setMicOk(false); // mic denied/unavailable — still usable via typed commands
          }
        }
      } else if (m.type === 'audio') {
        player.play(m.audio);
      } else if (m.type === 'interrupted') {
        player.clear();
      } else if (m.type === 'transcript') {
        const line: Transcript = {
          who: m.who === 'ai' ? 'ai' : 'user',
          text: String(m.text ?? ''),
          partial: Boolean(m.partial),
          ...(typeof m.itemId === 'string' && m.itemId ? { itemId: m.itemId } : {}),
        };
        setTranscripts((t) => applyTranscript(t, line));
      } else if (m.type === 'spec') {
        optsRef.current.onSpec(m.spec);
      } else if (m.type === 'readRequest') {
        // server (read_ui) wants the CURRENT screen — answer with live context
        const { readable } = optsRef.current.getContext();
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'readResponse', id: m.id, readable }));
      } else if (m.type === 'error') {
        setError(typeof m.message === 'string' ? m.message : 'Voice error');
        setStatus('error');
      }
    };
  }, [stop]);

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState === 1 && text.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const updateContext = useCallback(() => {
    if (wsRef.current?.readyState === 1) {
      const { spec, readable } = optsRef.current.getContext();
      wsRef.current.send(JSON.stringify({ type: 'context', spec, readable }));
    }
  }, []);

  return { status, transcripts, micOk, error, start, stop, sendText, updateContext };
}
