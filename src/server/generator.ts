/**
 * Generation layer. The rest of the app talks to the `Generator` interface, so
 * swapping the offline stub for a real LLM is a one-line change in `getGenerator`.
 */
import { GoogleGenAI } from '@google/genai';
import type { JSONValue, UINode, UISpec } from '../shared/spec.ts';

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
 * store. Names that clash with expr-eval built-ins are left untouched — consistently
 * across state keys, initialState, and bind expressions — so function calls survive.
 */
function namespaceScreen(spec: UISpec, prefix: string): { tree: UINode[]; initialState: Record<string, JSONValue> } {
  const raw = new Set<string>(Object.keys(spec.initialState ?? {}));
  const collect = (n: UINode) => {
    const sk = (n.props as any)?.stateKey;
    if (typeof sk === 'string') raw.add(sk);
    const ak = (n.props as any)?.action?.key;
    if (typeof ak === 'string') raw.add(ak);
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
      const props: any = { ...node.props };
      if (typeof props.stateKey === 'string' && vars.has(props.stateKey)) props.stateKey = prefix + props.stateKey;
      if (props.action && typeof props.action.key === 'string' && vars.has(props.action.key)) {
        props.action = { ...props.action, key: prefix + props.action.key };
      }
      node.props = props;
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
import { SYSTEM_PROMPT } from './prompt.ts';
import { validateSpec } from './validate.ts';

export interface Generator {
  readonly name: 'stub' | 'gemini';
  generate(prompt: string): Promise<UISpec>;
  /** Apply a natural-language change to an existing spec, returning the full updated spec. */
  refine(prompt: string, spec: UISpec): Promise<UISpec>;
  /** Multi-screen apps: plan screens, generate each independently, assemble into Tabs. */
  generateApp(prompt: string): Promise<UISpec>;
}

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

/**
 * Offline generator: keyword-matches the prompt to a pre-baked example, or
 * falls back to an "echo" card that explains what a live model would build.
 * Lets the whole playground run with zero configuration.
 */
export class StubGenerator implements Generator {
  readonly name = 'stub' as const;

  async generate(prompt: string): Promise<UISpec> {
    // No canned specs — the offline stub can't generate. Point the user at a model.
    return echoSpec(prompt, 'No model connected');
  }

  /** The offline stub can't reason about edits — it returns the spec unchanged. */
  async refine(_prompt: string, spec: UISpec): Promise<UISpec> {
    return spec;
  }

  async generateApp(prompt: string): Promise<UISpec> {
    return this.generate(prompt);
  }
}

/** Live generation via Gemini (new @google/genai SDK). */
export class GeminiGenerator implements Generator {
  readonly name = 'gemini' as const;
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const key = apiKey();
    if (!key) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required for the gemini generator.');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  }

  async generate(prompt: string): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: `Build: ${prompt}` }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      });
      text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const finishReason = result.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') console.warn(`[gemini] finishReason=${finishReason} (output may be truncated or blocked)`);
      if (!text.trim()) throw new Error('Model returned an empty response.');

      const parsed = JSON.parse(extractJSON(text));
      const { spec, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini] ${warnings.length} spec warning(s):`, warnings);
      return spec;
    } catch (err) {
      console.error('[gemini] generation failed:', (err as Error).message);
      if (text) console.error('[gemini] raw (first 500):', text.slice(0, 500));
      // Never hard-fail the demo: return a readable fallback card.
      return echoSpec(prompt, `Couldn't build that one — ${(err as Error).message}`);
    }
  }

  async refine(prompt: string, spec: UISpec): Promise<UISpec> {
    let text = '';
    try {
      const result = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Current UI spec (JSON):\n${JSON.stringify(spec)}\n\n` +
                  `Apply this change and return the COMPLETE updated spec: ${prompt}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      });
      text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const finishReason = result.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') console.warn(`[gemini] finishReason=${finishReason} (output may be truncated or blocked)`);
      if (!text.trim()) throw new Error('Model returned an empty response.');
      const parsed = JSON.parse(extractJSON(text));
      const { spec: out, warnings } = validateSpec(parsed);
      if (warnings.length) console.warn(`[gemini refine] ${warnings.length} warning(s):`, warnings);
      return out;
    } catch (err) {
      console.error('[gemini refine] failed:', (err as Error).message);
      return spec; // keep the current UI on failure
    }
  }

  // Multi-step generation for large multi-screen apps: plan the screens, generate
  // each independently (parallel — sidesteps the per-response token ceiling and
  // raises per-screen quality), then assemble into a Tabs shell.
  async generateApp(prompt: string): Promise<UISpec> {
    try {
      const planText =
        (
          await this.ai.models.generateContent({
            model: this.model,
            contents: [{ role: 'user', parts: [{
              text:
                'Plan a multi-screen interface for this request. Return ONLY JSON: ' +
                '{"title": string, "screens": [{"title": string, "prompt": string}]} with 2 to 5 screens. ' +
                'Each "prompt" is a complete, self-contained instruction to build that ONE screen. Request: ' + prompt,
            }] }],
            config: { temperature: 0.5, maxOutputTokens: 2048, responseMimeType: 'application/json' },
          })
        ).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const plan = JSON.parse(extractJSON(planText));
      const screens: Array<{ title?: string; prompt?: string }> = Array.isArray(plan?.screens) ? plan.screens.slice(0, 5) : [];
      if (screens.length < 2) return this.generate(prompt); // not actually multi-screen

      const specs = await Promise.all(screens.map((s) => this.generate(`${s.title ?? ''}: ${s.prompt ?? ''}`)));
      const initialState: Record<string, JSONValue> = {};
      const children = specs.map((spec, i) => {
        const ns = namespaceScreen(spec, `s${i}_`); // isolate each screen's state + ids
        Object.assign(initialState, ns.initialState);
        return { id: `screen-${i}`, type: 'Stack', children: ns.tree };
      });
      const assembled: UISpec = {
        title: typeof plan?.title === 'string' ? plan.title : 'App',
        initialState,
        tree: [{ id: 'app-tabs', type: 'Tabs', props: { tabs: screens.map((s) => s.title ?? 'Screen') }, children }],
      };
      return validateSpec(assembled).spec; // also catches any residual id collisions
    } catch (e) {
      console.error('[gemini generateApp] failed:', (e as Error).message);
      return this.generate(prompt);
    }
  }
}

/** A friendly fallback spec shown when generation is unavailable or fails. */
function echoSpec(prompt: string, title: string): UISpec {
  return {
    title,
    tree: [
      {
        id: 'card',
        type: 'Card',
        props: { title, subtitle: 'Offline preview' },
        children: [
          {
            id: 'note',
            type: 'Text',
            props: {
              value:
                `You asked for: “${prompt}”.\n\n` +
                'Try one of the built-in examples — tip calculator, counter, or ' +
                'bouncing ball — which run fully offline.',
            },
          },
          { id: 'badge', type: 'Badge', props: { label: 'fallback', tone: 'muted' } },
        ],
      },
    ],
  };
}

/**
 * Extract the first complete, balanced JSON value from a model response.
 * String/escape-aware, so prose containing braces or a trailing fenced block
 * can't corrupt the parse (the old greedy `\{[\s\S]*\}` could).
 */
function extractJSON(text: string): string {
  // If there are fenced blocks, prefer the first one that actually holds JSON
  // (a preamble fence with prose/examples shouldn't win); else scan the raw text.
  let src = text;
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (/^\s*[{[]/.test(m[1])) { src = m[1]; break; }
  }
  const start = src.search(/[{[]/);
  if (start < 0) return src.trim();
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start).trim(); // unbalanced (likely truncated) — return what we have
}

export function getGenerator(): Generator {
  if (process.env.GENERATOR === 'gemini' && apiKey()) {
    try {
      return new GeminiGenerator();
    } catch (err) {
      console.warn('[generator] gemini unavailable, falling back to stub:', (err as Error).message);
    }
  }
  return new StubGenerator();
}
