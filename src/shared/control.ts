/**
 * The UI control surface: what a generated screen lets an agent DO, without
 * regenerating it. Shared by the chat endpoint, the voice tools and the client.
 *
 * Registry UIs expose their state keys and buttons automatically. Sandboxed
 * artifacts opt in by calling `genui.expose({...})` inside the iframe; their
 * actions arrive over postMessage and run there.
 */
import type { JSONValue, UISpec } from './spec.ts';

export type ControlKind = 'number' | 'boolean' | 'text' | 'choice' | 'button' | 'action';

export interface UIControl {
  /** Stable id an agent passes back: `set:<key>`, `press:<nodeId>` or `call:<name>`. */
  id: string;
  kind: ControlKind;
  label: string;
  value?: JSONValue;
  min?: number;
  max?: number;
  options?: JSONValue[];
  /** Artifact actions: what it does and its parameters (name -> type/description). */
  description?: string;
  params?: Record<string, string>;
}

export interface UIAct {
  action: string;
  value?: JSONValue;
  args?: Record<string, JSONValue>;
}

export interface UIActResult {
  action: string;
  ok: boolean;
  detail?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  message: string;
  spec: UISpec | null;
  readable: string;
  controls: UIControl[];
  history?: ChatTurn[];
}

export type ChatChange = 'none' | 'refine' | 'generate';

export interface ChatResponse {
  reply: string;
  acts: UIAct[];
  change: ChatChange;
  /** Present when the change rebuilt the UI. */
  spec?: UISpec;
  /** False when a requested rebuild did not apply. */
  ok: boolean;
}

const MAX_CONTROLS = 60;

/** One line per control, compact enough for a model prompt or a voice tool result. */
export function describeControls(controls: UIControl[]): string {
  if (!controls.length) return 'No operable controls (only refine/generate can change this screen).';
  return controls
    .slice(0, MAX_CONTROLS)
    .map((c) => {
      const bits: string[] = [`${c.id} — ${c.label}`];
      if (c.kind === 'number') bits.push(`number${c.min !== undefined || c.max !== undefined ? ` ${c.min ?? '…'}..${c.max ?? '…'}` : ''}`);
      else if (c.kind === 'choice') bits.push(`one of ${JSON.stringify(c.options ?? [])}`);
      else if (c.kind === 'boolean') bits.push('true/false');
      else if (c.kind === 'text') bits.push('text');
      else if (c.kind === 'button') bits.push('press (no value)');
      else if (c.kind === 'action') {
        if (c.description) bits.push(c.description);
        if (c.params && Object.keys(c.params).length) bits.push(`args ${JSON.stringify(c.params)}`);
      }
      if (c.value !== undefined && c.kind !== 'button' && c.kind !== 'action') bits.push(`now ${JSON.stringify(c.value)}`);
      return `- ${bits.join(' · ')}`;
    })
    .join('\n');
}

/** Normalize untrusted acts from a model or a socket into a bounded list. */
export function sanitizeActs(raw: unknown, max = 12): UIAct[] {
  if (!Array.isArray(raw)) return [];
  const out: UIAct[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { action, value, args } = item as Record<string, unknown>;
    if (typeof action !== 'string' || !/^(set|press|call):[\w.$-]{1,80}$/.test(action)) continue;
    const act: UIAct = { action };
    if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value)) act.value = value as JSONValue;
    if (args && typeof args === 'object' && !Array.isArray(args)) act.args = args as Record<string, JSONValue>;
    out.push(act);
    if (out.length >= max) break;
  }
  return out;
}
