/**
 * The control hub: one place that knows what the live UI can DO and runs it.
 *
 * - Registry lane: every input stateKey, every seeded state value and every
 *   Button action is operable through the GeneratedApp's state API.
 * - Sandboxed lanes: an artifact calls `genui.expose({...})` inside its iframe;
 *   the catalog arrives by postMessage and calls run inside the iframe.
 *
 * Chat and voice both go through `controls()` and `run()`, so typing "set the
 * rate to 6%" and saying it do exactly the same thing.
 */
import type { JSONValue, UIAction, UINode, UISpec } from '../../shared/spec';
import type { UIAct, UIActResult, UIControl } from '../../shared/control';

export interface StateBinding {
  spec: UISpec;
  getState: () => Record<string, JSONValue>;
  setVar: (key: string, value: JSONValue) => void;
  dispatch: (action: UIAction) => void;
}

export interface FrameAction {
  name: string;
  description?: string;
  params?: Record<string, string>;
}

interface FrameEntry {
  win: Window;
  actions: FrameAction[];
}

const INPUTS: Record<string, UIControl['kind']> = {
  Slider: 'number',
  NumberInput: 'number',
  Toggle: 'boolean',
  TextInput: 'text',
  ColorPicker: 'text',
  Select: 'choice',
  RadioGroup: 'choice',
};

function walk(nodes: UINode[], visit: (n: UINode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children?.length) walk(n.children, visit);
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Derive registry controls from a spec and the current state. Pure, for tests. */
export function registryControls(spec: UISpec, state: Record<string, JSONValue>): UIControl[] {
  const out: UIControl[] = [];
  const seen = new Set<string>();
  walk(spec.tree, (n) => {
    const p = (n.props ?? {}) as Record<string, unknown>;
    const kind = INPUTS[n.type];
    const key = typeof p.stateKey === 'string' ? p.stateKey : '';
    if (kind && key && !seen.has(key)) {
      seen.add(key);
      const c: UIControl = { id: `set:${key}`, kind, label: String(p.label ?? key), value: state[key] };
      if (kind === 'number') {
        const min = num(p.min);
        const max = num(p.max);
        if (min !== undefined) c.min = min;
        if (max !== undefined) c.max = max;
      }
      if (kind === 'choice' && Array.isArray(p.options)) {
        c.options = (p.options as { value?: JSONValue; label?: JSONValue }[]).map((o) => (o && typeof o === 'object' ? (o.value ?? o.label ?? null) : (o as JSONValue)));
      }
      out.push(c);
    }
    if (n.type === 'Button' && p.action && typeof p.action === 'object') {
      out.push({ id: `press:${n.id}`, kind: 'button', label: String(p.label ?? n.id) });
    }
  });
  // Seeded values no input writes (a counter driven by buttons, a mode flag) are still settable.
  for (const [key, value] of Object.entries(state)) {
    if (seen.has(key)) continue;
    const kind: UIControl['kind'] | null = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'text' : null;
    if (kind) out.push({ id: `set:${key}`, kind, label: key, value });
  }
  return out;
}

/** Coerce an agent-supplied value to what a control accepts. Returns an error string on failure. */
export function coerceValue(c: UIControl, value: JSONValue | undefined): { value: JSONValue } | { error: string } {
  if (value === undefined) return { error: 'a value is required' };
  if (c.kind === 'number') {
    // "6.25%" or "$90,000" parse; text with no digits does not (Number('') would be 0).
    const n = typeof value === 'number' ? value : /\d/.test(String(value)) ? Number(String(value).replace(/[^0-9.eE+-]/g, '')) : NaN;
    if (!Number.isFinite(n)) return { error: `not a number: ${JSON.stringify(value)}` };
    const clamped = Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n));
    return { value: clamped };
  }
  if (c.kind === 'boolean') {
    if (typeof value === 'boolean') return { value };
    const s = String(value).toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(s)) return { value: true };
    if (['false', 'off', 'no', '0'].includes(s)) return { value: false };
    return { error: `not true/false: ${JSON.stringify(value)}` };
  }
  if (c.kind === 'choice') {
    const opts = c.options ?? [];
    const hit = opts.find((o) => o === value) ?? opts.find((o) => String(o).toLowerCase() === String(value).toLowerCase());
    return hit !== undefined ? { value: hit } : { error: `not one of ${JSON.stringify(opts)}` };
  }
  return { value: String(value) };
}

function findNode(nodes: UINode[], id: string): UINode | null {
  let hit: UINode | null = null;
  walk(nodes, (n) => { if (!hit && n.id === id) hit = n; });
  return hit;
}

class ControlHub {
  private binding: StateBinding | null = null;
  private frames = new Map<string, FrameEntry>();
  private pending = new Map<string, (r: UIActResult) => void>();
  private listeners = new Set<() => void>();

  attachState(binding: StateBinding | null): void {
    this.binding = binding;
  }

  registerFrame(nodeId: string, win: Window, actions: FrameAction[]): void {
    this.frames.set(nodeId, { win, actions: actions.slice(0, 30) });
    this.emit();
  }

  unregisterFrame(nodeId: string): void {
    if (this.frames.delete(nodeId)) this.emit();
  }

  /** Called by iframe hosts when a `__genuiResult` arrives. */
  resolve(result: { id?: unknown; ok?: unknown; detail?: unknown }): void {
    const id = typeof result.id === 'string' ? result.id : '';
    const cb = this.pending.get(id);
    if (!cb) return;
    this.pending.delete(id);
    cb({ action: '', ok: result.ok === true, ...(result.detail != null ? { detail: String(result.detail) } : {}) });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  controls(): UIControl[] {
    const out: UIControl[] = [];
    if (this.binding) out.push(...registryControls(this.binding.spec, this.binding.getState()));
    for (const { actions } of this.frames.values()) {
      for (const a of actions) {
        out.push({ id: `call:${a.name}`, kind: 'action', label: a.name, ...(a.description ? { description: a.description } : {}), ...(a.params ? { params: a.params } : {}) });
      }
    }
    return out;
  }

  async run(acts: UIAct[]): Promise<UIActResult[]> {
    const results: UIActResult[] = [];
    for (const act of acts) results.push(await this.runOne(act));
    return results;
  }

  private async runOne(act: UIAct): Promise<UIActResult> {
    const [verb, target] = [act.action.slice(0, act.action.indexOf(':')), act.action.slice(act.action.indexOf(':') + 1)];
    if (verb === 'set' || verb === 'press') {
      const b = this.binding;
      if (!b) return { action: act.action, ok: false, detail: 'no registry UI on screen' };
      if (verb === 'press') {
        const node = findNode(b.spec.tree, target);
        const action = node?.type === 'Button' ? (node.props?.action as UIAction | undefined) : undefined;
        if (!action) return { action: act.action, ok: false, detail: 'no such button' };
        b.dispatch(action);
        return { action: act.action, ok: true, detail: `pressed ${String(node?.props?.label ?? target)}` };
      }
      const control = registryControls(b.spec, b.getState()).find((c) => c.id === act.action);
      if (!control) return { action: act.action, ok: false, detail: 'no such value' };
      const coerced = coerceValue(control, act.value);
      if ('error' in coerced) return { action: act.action, ok: false, detail: coerced.error };
      b.setVar(target, coerced.value);
      return { action: act.action, ok: true, detail: `${control.label} = ${JSON.stringify(coerced.value)}` };
    }
    if (verb === 'call') {
      const frame = [...this.frames.values()].find((f) => f.actions.some((a) => a.name === target));
      if (!frame) return { action: act.action, ok: false, detail: 'no such app action' };
      const id = Math.random().toString(36).slice(2);
      const result = await new Promise<UIActResult>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ action: act.action, ok: false, detail: 'the app did not respond' }); }, 4000);
        this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
        frame.win.postMessage({ __genuiCall: { id, name: target, args: act.args ?? {} } }, '*');
      });
      return { ...result, action: act.action };
    }
    return { action: act.action, ok: false, detail: 'unknown action' };
  }
}

export const controlHub = new ControlHub();

/** Read the actions catalog and results an artifact iframe posts to its host. */
export function parseFrameActions(data: unknown): FrameAction[] | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { __genuiActions?: unknown }).__genuiActions)) return null;
  return ((data as { __genuiActions: unknown[] }).__genuiActions)
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string')
    .map((a) => ({
      name: String(a.name).slice(0, 60),
      ...(typeof a.description === 'string' ? { description: a.description.slice(0, 200) } : {}),
      ...(a.params && typeof a.params === 'object' ? { params: Object.fromEntries(Object.entries(a.params as Record<string, unknown>).slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 80)])) } : {}),
    }))
    .filter((a) => /^[\w.$-]{1,60}$/.test(a.name));
}
