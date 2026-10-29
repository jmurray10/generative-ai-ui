/**
 * Shared spec helpers used by every generator: the offline notice, per-screen
 * namespacing, and the plan→tabs assembly step.
 */
import type { JSONValue, UINode, UISpec } from '../shared/spec.ts';
import { validateSpec } from './validate.ts';

export const FALLBACK_ROOT_ID = 'fallback-card';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// expr-eval built-ins / literals — never rename these, even if a screen happens to
// seed a state var with the same name; renaming would turn `max(a,b)` into the
// undefined function `s0_max(a,b)` and break every bind on that screen.
const EXPR_RESERVED = new Set([
  'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow',
  'PI', 'E', 'true', 'false', 'if', 'and', 'or', 'not', 'in',
]);

/**
 * Prefix every state key, action key, bind identifier, and node id in a screen's
 * spec so independently-generated screens can't collide in the shared reactive
 * store. Names that clash with expr-eval built-ins are left untouched.
 */
export function namespaceScreen(spec: UISpec, prefix: string): { tree: UINode[]; initialState: Record<string, JSONValue> } {
  const raw = new Set<string>(Object.keys(spec.initialState ?? {}));
  const collect = (n: UINode) => {
    const props = n.props as { stateKey?: unknown; action?: { key?: unknown } } | undefined;
    if (typeof props?.stateKey === 'string') raw.add(props.stateKey);
    if (typeof props?.action?.key === 'string') raw.add(props.action.key);
    (n.children ?? []).forEach(collect);
  };
  (spec.tree ?? []).forEach(collect);
  const vars = new Set([...raw].filter((v) => !EXPR_RESERVED.has(v)));

  const renameExpr = (expr: string): string => {
    let out = expr;
    for (const v of vars) out = out.replace(new RegExp(`\\b${escapeRegExp(v)}\\b`, 'g'), prefix + v);
    return out;
  };
  const walk = (n: UINode): UINode => {
    const node: UINode = { ...n, id: prefix + n.id };
    if (node.props) {
      const props = { ...node.props } as Record<string, JSONValue | { type: string; key?: string; value?: JSONValue }>;
      if (typeof props.stateKey === 'string' && vars.has(props.stateKey)) props.stateKey = prefix + props.stateKey;
      const action = props.action;
      if (action && typeof action === 'object' && !Array.isArray(action) && typeof action.key === 'string' && vars.has(action.key)) {
        props.action = { ...action, key: prefix + action.key };
      }
      node.props = props as UINode['props'];
    }
    if (node.bind) {
      const b: Record<string, string> = {};
      for (const [k, ex] of Object.entries(node.bind)) b[k] = renameExpr(ex);
      node.bind = b;
    }
    if (node.children) node.children = node.children.map(walk);
    return node;
  };

  const tree = (spec.tree ?? []).map(walk);
  const initialState: Record<string, JSONValue> = {};
  for (const [k, val] of Object.entries(spec.initialState ?? {})) initialState[vars.has(k) ? prefix + k : k] = val;
  return { tree, initialState };
}

/** A friendly fallback spec shown when generation is unavailable or fails. */
export function echoSpec(prompt: string, title: string): UISpec {
  return {
    title,
    tree: [
      {
        id: FALLBACK_ROOT_ID,
        type: 'Card',
        props: { title, subtitle: 'Model not connected' },
        children: [
          {
            id: 'note',
            type: 'Text',
            props: {
              value:
                `You asked for: “${prompt}”.\n\n` +
                'Nothing is generated offline. Set XAI_API_KEY and leave GENERATOR=grok (the default) ' +
                'to build this with Grok. Gemini remains available with GENERATOR=gemini and a Gemini key.',
            },
          },
          { id: 'badge', type: 'Badge', props: { label: 'fallback', tone: 'muted' } },
        ],
      },
    ],
  };
}

export function isDegradedSpec(spec: UISpec): boolean {
  return spec.tree.some((node) => node.id === FALLBACK_ROOT_ID || node.id.endsWith(FALLBACK_ROOT_ID));
}

interface PlanScreen {
  title?: string;
  prompt?: string;
}

/** Turn a plan payload into a tabbed spec. Fewer than two screens falls back to one generate. */
export async function buildAppFromPlan(
  plan: { title?: unknown; screens?: unknown },
  prompt: string,
  generate: (screenPrompt: string) => Promise<UISpec>,
): Promise<UISpec> {
  const screens: PlanScreen[] = Array.isArray(plan?.screens)
    ? (plan.screens as PlanScreen[]).slice(0, 5)
    : [];
  if (screens.length < 2) return generate(prompt);

  const specs = await Promise.all(screens.map((s) => generate(`${s.title ?? ''}: ${s.prompt ?? ''}`)));
  const initialState: Record<string, JSONValue> = {};
  const children = specs.map((spec, i) => {
    const ns = namespaceScreen(spec, `s${i}_`);
    Object.assign(initialState, ns.initialState);
    return { id: `screen-${i}`, type: 'Stack', children: ns.tree };
  });
  const assembled: UISpec = {
    title: typeof plan?.title === 'string' ? plan.title : 'App',
    initialState,
    tree: [{ id: 'app-tabs', type: 'Tabs', props: { tabs: screens.map((s) => s.title ?? 'Screen') }, children }],
  };
  return validateSpec(assembled).spec;
}
