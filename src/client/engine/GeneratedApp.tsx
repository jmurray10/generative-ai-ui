/**
 * Renders a UISpec into live React. Owns the reactive store for one generation
 * and resolves `bind` expressions per node on every render. Unknown component
 * types degrade gracefully instead of crashing the tree.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { JSONValue, UIAction, UINode, UISpec } from '../../shared/spec';
import { registry } from './components';
import { GenStateContext, evalExpr, applyAction, type StateMap } from './state';

/** Color helpers for deterministic, WCAG-aware theming. A model can pick any
 *  palette; these guarantee the rendered text stays legible regardless. */
type RGB = [number, number, number];
function parseHex(hex?: string): RGB | null {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const ch = (c: RGB) => `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function relLum([r, g, b]: RGB): number {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: RGB, b: RGB): number {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
/** Keep fg legible on bg; if it fails the target ratio, flip to whichever extreme contrasts best. */
function ensureOn(fg: RGB, bg: RGB, target = 4.5): RGB {
  if (contrast(fg, bg) >= target) return fg;
  return contrast(WHITE, bg) >= contrast(BLACK, bg) ? WHITE : BLACK;
}
/** Dim text toward surface as far as possible while staying >= target contrast. */
function deriveMuted(text: RGB, surface: RGB, target = 4.5): RGB {
  for (let t = 0.55; t > 0; t -= 0.05) {
    const m = mix(text, surface, t);
    if (contrast(m, surface) >= target) return m;
  }
  return ensureOn(text, surface, target); // text itself failed — flip to a legible extreme
}

function Unknown({ type }: { type: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      Unknown component: <code>{type}</code>
    </div>
  );
}

const Node: React.FC<{ node: UINode; state: StateMap }> = ({ node, state }) => {
  const Comp = registry[node.type];
  const children = node.children?.map((c) => <Node key={c.id} node={c} state={state} />);
  if (!Comp) return <Unknown type={node.type} />;

  const bound: Record<string, unknown> = {};
  if (node.bind) {
    for (const [prop, expr] of Object.entries(node.bind)) bound[prop] = evalExpr(expr, state);
  }
  return (
    <Comp {...(node.props as object)} {...bound}>
      {children}
    </Comp>
  );
};

export const GeneratedApp: React.FC<{ spec: UISpec }> = ({ spec }) => {
  // Depend on initialState identity (not the whole spec) so streaming new nodes
  // into spec.tree doesn't churn the seed on every frame.
  const initialState = useMemo<StateMap>(() => ({ ...(spec.initialState ?? {}) }), [spec.initialState]);
  const [state, setState] = useState<StateMap>(initialState);

  const api = useMemo(
    () => ({
      state,
      setVar: (key: string, value: JSONValue) => setState((s) => ({ ...s, [key]: value })),
      dispatch: (action: UIAction) => setState((s) => applyAction(s, initialState, action)),
    }),
    [state, initialState],
  );

  // Build scoped --gp-* overrides from the optional theme (no per-component refactor:
  // the registry's Tailwind tokens already read these variables).
  const themeStyle = useMemo<React.CSSProperties | undefined>(() => {
    const t = spec.theme;
    if (!t) return undefined;
    const bg = parseHex(t.bg) ?? [11, 11, 18];
    const surface = parseHex(t.surface) ?? [21, 21, 31];
    const text = ensureOn(parseHex(t.text) ?? [231, 231, 240], surface, 4.5); // legible body text on cards
    const muted = deriveMuted(text, surface); // guaranteed-legible secondary text
    const accent = parseHex(t.accent) ?? [124, 92, 255];
    const accentSoft = mix(accent, WHITE, 0.28);
    const onAccent = contrast(WHITE, accent) >= contrast(BLACK, accent) ? WHITE : BLACK; // solid-button text
    const edge = parseHex(t.border) ?? mix(surface, text, 0.16);
    // focus ring must be visible against the page bg (WCAG 2.4.11 ≥3:1)
    const focus = contrast(accentSoft, bg) >= 3 ? accentSoft : ensureOn(accentSoft, bg, 3);
    const s: Record<string, string> = {
      '--gp-canvas': ch(bg),
      '--gp-panel': ch(surface),
      '--gp-edge': ch(edge),
      '--gp-ink': ch(text),
      '--gp-muted': ch(muted),
      '--gp-accent': ch(accent),
      '--gp-accent-soft': ch(accentSoft), // perceptual shade toward white
      '--gp-accent-deep': ch(mix(accent, BLACK, 0.28)), // perceptual shade toward black
      '--gp-on-accent': ch(onAccent),
      '--gp-focus': ch(focus),
    };
    if (t.font) (s as Record<string, string>).fontFamily = `'${t.font}', system-ui, sans-serif`;
    return s as React.CSSProperties;
  }, [spec.theme]);

  // load a Google Font if the theme asked for one
  useEffect(() => {
    const font = spec.theme?.font;
    if (!font || document.querySelector(`link[data-gp-font="${font}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;700&display=swap`;
    link.dataset.gpFont = font;
    document.head.appendChild(link);
  }, [spec.theme?.font]);

  // Tint the whole page to the theme bg so a themed UI doesn't float on the app's
  // purple gradient. Restored on unmount (GeneratedApp is keyed per generation).
  useEffect(() => {
    const bg = spec.theme?.bg;
    if (!bg) return;
    const { style } = document.body;
    const prev = { color: style.backgroundColor, image: style.backgroundImage };
    style.backgroundColor = bg;
    style.backgroundImage = 'none';
    return () => { style.backgroundColor = prev.color; style.backgroundImage = prev.image; };
  }, [spec.theme?.bg]);

  return (
    <GenStateContext.Provider value={api}>
      <section
        aria-label="Generated interface"
        style={themeStyle}
        className={`flex flex-col gap-4 ${spec.theme ? 'rounded-2xl bg-canvas p-5' : ''}`}
      >
        {spec.tree.map((node) => (
          <div key={node.id} className="animate-rise">
            <Node node={node} state={state} />
          </div>
        ))}
      </section>
    </GenStateContext.Provider>
  );
};
