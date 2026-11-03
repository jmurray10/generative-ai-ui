import type { Example, GenerateResponse, UINode, UISpec } from '../shared/spec';
import type { ChatRequest, ChatResponse } from '../shared/control';
import type { DecisionEnvelope } from '../shared/toolbox';

export async function fetchExamples(): Promise<Example[]> {
  const res = await fetch('/api/examples');
  if (!res.ok) throw new Error(`examples: ${res.status}`);
  return res.json();
}

export async function generate(prompt: string): Promise<GenerateResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `generate: ${res.status}`);
  }
  return res.json();
}

export interface StreamHandlers {
  onMeta?: (m: { title: string | null; initialState: Record<string, any>; count: number; source: string; degraded?: boolean; notices?: string[] }) => void;
  onNode?: (n: { index: number; node: UINode }) => void;
  onDone?: (d: { spec: UISpec }) => void;
  onError?: (error: string) => void;
}

/**
 * Stream a generation (or refinement, if `spec` is passed) over SSE, invoking
 * handlers as `meta` / `node` / `done` / `error` frames arrive. Powers the
 * "watch it build itself" reveal.
 */
export async function streamSpec(
  body: { prompt: string; spec?: UISpec; lane?: string; components?: string[]; style?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw e;
  }
  if (!res.ok || !res.body) {
    handlers.onError?.(`stream: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotDone = false;

  const handleFrame = (frame: string) => {
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'meta') handlers.onMeta?.(parsed);
    else if (event === 'node') handlers.onNode?.(parsed);
    else if (event === 'done') { gotDone = true; handlers.onDone?.(parsed); }
    else if (event === 'error') { gotDone = true; handlers.onError?.(parsed.error); } // terminal — don't double-fire the close fallback
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        handleFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') handlers.onError?.(String(e));
    return;
  }
  // stream closed without a `done` (and not user-aborted) → don't get stuck "building"
  if (!gotDone && !signal?.aborted) handlers.onError?.('The connection closed before the UI finished — please try again.');
}

async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `${url}: ${res.status}`);
  return data as T;
}

/** Jev toolbox decision for a prompt: route, ask one question, or hold. */
export function decide(prompt: string, answered = false, signal?: AbortSignal): Promise<DecisionEnvelope> {
  return postJSON<DecisionEnvelope>('/api/decide', { prompt, answered }, signal);
}

/** One chat turn with the live UI: answer, operate (acts), or rebuild. */
export function chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return postJSON<ChatResponse>('/api/chat', req, signal);
}
