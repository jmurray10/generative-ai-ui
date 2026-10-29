/**
 * The whitelisted component vocabulary. Every component is "dumb" about
 * generation — it just renders props (already resolved, incl. bindings) and,
 * for inputs/actions, talks to the shared reactive store. Charts and gauges are
 * dependency-free inline SVG to keep the bundle small.
 *
 * Keep this list in sync with src/server/prompt.ts and src/server/validate.ts.
 */
import React, { useEffect, useRef, useState } from 'react';
import { formatReadout, gaugePresentation } from './format';
import { isStepAligned, sliderBounds } from './slider';
import { useGenState } from './state';
import type { UIAction } from '../../shared/spec';

type Props = Record<string, any> & { children?: React.ReactNode };

const PALETTE = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#f87171', '#a78bfa'];

/** Normalize chart data to [{label, value, color?}] from numbers or objects. */
function asPoints(data: any): { label: string; value: number; color?: string }[] {
  if (!Array.isArray(data)) return [];
  return data.map((d, i) =>
    typeof d === 'number'
      ? { label: String(i + 1), value: d }
      : { label: String(d?.label ?? i + 1), value: Number(d?.value) || 0, color: d?.color },
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Reject model-chosen colors that vanish against the dark canvas → use palette. */
function safeColor(color: any, fallback: string): string {
  if (typeof color !== 'string' || !HEX.test(color)) return fallback;
  return luminance(color) < 0.16 ? fallback : color;
}
function fmt(n: number, decimals?: number): string {
  return formatReadout(n, '', '', decimals);
}

// ===== Layout =============================================================
const Stack: React.FC<Props> = ({ children }) => <div className="flex flex-col gap-4">{children}</div>;

const Row: React.FC<Props> = ({ children }) => <div className="flex flex-wrap gap-4">{children}</div>;

const Grid: React.FC<Props> = ({ children }) => (
  <div
    className="grid gap-4"
    // auto-fit so columns collapse gracefully on narrow screens (no overflow)
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}
  >
    {children}
  </div>
);

const Card: React.FC<Props> = ({ title, subtitle, children }) => (
  <section className="rounded-2xl border border-edge bg-panel/80 p-6 shadow-xl shadow-black/30 backdrop-blur">
    {(title || subtitle) && (
      <header className="mb-5">
        {title && <h3 className="text-lg font-semibold text-ink">{title}</h3>}
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </header>
    )}
    <div className="flex flex-col gap-4">{children}</div>
  </section>
);

const Tabs: React.FC<Props> = ({ tabs, children }) => {
  const [active, setActive] = useState(0);
  const uid = React.useId();
  const items = React.Children.toArray(children);
  const labels: string[] = Array.isArray(tabs) && tabs.length ? tabs : items.map((_, i) => `Tab ${i + 1}`);
  const idx = Math.min(active, Math.max(0, items.length - 1));
  return (
    <div>
      <div role="tablist" aria-label="Screens" className="mb-3 flex gap-1 border-b border-edge">
        {labels.map((l, i) => (
          <button
            type="button"
            role="tab"
            id={`${uid}-tab-${i}`}
            aria-selected={i === idx}
            aria-controls={`${uid}-panel`}
            key={i}
            onClick={() => setActive(i)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${i === idx ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${idx}`}>{items[idx]}</div>
    </div>
  );
};

const Collapsible: React.FC<Props> = ({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-xl border border-edge bg-panel/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink"
      >
        <span>{title}</span>
        <span className="text-muted">{open ? '–' : '+'}</span>
      </button>
      {open && <div className="flex flex-col gap-4 border-t border-edge p-4">{children}</div>}
    </div>
  );
};

const Divider: React.FC<Props> = ({ label }) =>
  label ? (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
      <span className="h-px flex-1 bg-edge" />
      {label}
      <span className="h-px flex-1 bg-edge" />
    </div>
  ) : (
    <hr className="border-edge" />
  );

// ===== Display ============================================================
const Heading: React.FC<Props> = ({ value }) => <h2 className="text-2xl font-bold text-ink">{value}</h2>;

const Text: React.FC<Props> = ({ value, stateKey }) => {
  const { state } = useGenState();
  const shown = stateKey != null ? String(state[stateKey] ?? '') : value;
  return <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{shown}</p>;
};

const Stat: React.FC<Props> = ({ label, value, prefix = '', suffix = '', decimals }) => {
  const shown = typeof value === 'number'
    ? formatReadout(value, String(prefix ?? ''), String(suffix ?? ''), typeof decimals === 'number' ? decimals : undefined)
    : value === undefined || value === null
      ? '—'
      : value;
  return (
    <div className="min-w-[7rem] flex-1 rounded-xl border border-edge bg-canvas/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{shown}</div>
    </div>
  );
};

const toneClass: Record<string, string> = {
  accent: 'bg-accent/15 text-accent-soft border-accent/30',
  muted: 'bg-canvas/60 text-muted border-edge',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

const Badge: React.FC<Props> = ({ label, tone = 'accent' }) => (
  <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${toneClass[tone] ?? toneClass.accent}`}>
    {label}
  </span>
);

const List: React.FC<Props> = ({ items, ordered = false }) => {
  const arr = Array.isArray(items) ? items : [];
  const cls = `${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5 text-sm text-muted`;
  return ordered ? (
    <ol className={cls}>{arr.map((it, i) => <li key={i}>{String(it)}</li>)}</ol>
  ) : (
    <ul className={cls}>{arr.map((it, i) => <li key={i}>{String(it)}</li>)}</ul>
  );
};

const KeyValue: React.FC<Props> = ({ rows }) => {
  const arr = Array.isArray(rows) ? rows : [];
  return (
    <dl className="divide-y divide-edge rounded-xl border border-edge">
      {arr.map((r, i) => (
        <div key={i} className="flex justify-between gap-4 px-4 py-2 text-sm">
          <dt className="text-muted">{String(r?.label ?? '')}</dt>
          <dd className="font-medium text-ink">{String(r?.value ?? '')}</dd>
        </div>
      ))}
    </dl>
  );
};

const ProgressBar: React.FC<Props> = ({ label, value = 0, max = 100, prefix = '', suffix = '' }) => {
  const n = typeof value === 'number' ? value : Number(value) || 0;
  const pct = Math.max(0, Math.min(100, (n / (Number(max) || 100)) * 100));
  const readout = formatReadout(n, String(prefix ?? ''), String(suffix ?? ''));
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-muted">{label}</span>
          <span className="tabular-nums text-ink">{readout}</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-edge"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Number(max) || 100}
        aria-valuenow={Number(value) || 0}
        aria-label={typeof label === 'string' && label ? label : 'Progress'}
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const Gauge: React.FC<Props> = ({ label, value = 0, min = 0, max = 100, prefix = '', suffix = '' }) => {
  const shown = gaugePresentation(Number(value), Number(min), Number(max), String(prefix ?? ''), String(suffix ?? ''));
  const cx = 80, cy = 80, r = 62;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy - r * Math.sin(ang)];
  const ang = Math.PI * (1 - shown.fraction);
  const [sx, sy] = pt(Math.PI);
  const [ex, ey] = pt(0);
  const [vx, vy] = pt(ang);
  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="92" viewBox="0 0 160 92" role="img" aria-label={`${label || 'Gauge'}: ${shown.text}`}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="#262635" strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${vx} ${vy}`} fill="none" stroke="#7c5cff" strokeWidth="12" strokeLinecap="round" />
        <circle cx={vx} cy={vy} r="6" fill="#9d86ff" />
      </svg>
      <div className="-mt-1 text-2xl font-semibold text-ink" data-gauge-value={Number(value)}>{shown.text}</div>
      {shown.outside && <div className="text-[10px] text-muted">Outside the {min}–{max} scale</div>}
      {label && <div className="text-xs uppercase tracking-wide text-muted">{label}</div>}
    </div>
  );
};

// ===== Charts (inline SVG) ================================================
const BarChart: React.FC<Props> = ({ data, color }) => {
  const pts = asPoints(data);
  const W = 320, H = 170, pad = 22;
  const max = Math.max(1, ...pts.map((p) => p.value));
  const bw = pts.length ? (W - pad * 2) / pts.length : 0;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={'Bar chart: ' + pts.map((p) => `${p.label} ${p.value}`).join(', ')}
    >
      {pts.map((p, i) => {
        const h = (p.value / max) * (H - pad * 2);
        const x = pad + i * bw;
        return (
          <g key={i}>
            <rect x={x + bw * 0.15} y={H - pad - h} width={bw * 0.7} height={h} rx="3" fill={safeColor(color, PALETTE[i % PALETTE.length])} />
            <text x={x + bw * 0.5} y={H - 7} textAnchor="middle" fontSize="10" fill="#b8b8cf">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
};

const LineChart: React.FC<Props> = ({ data, color: colorProp }) => {
  const color = safeColor(colorProp, '#7c5cff');
  const pts = asPoints(data);
  const W = 320, H = 170, pad = 22;
  const vals = pts.map((p) => p.value);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const sx = (i: number) => pad + (pts.length > 1 ? (i * (W - pad * 2)) / (pts.length - 1) : 0);
  const sy = (val: number) => H - pad - ((val - min) / ((max - min) || 1)) * (H - pad * 2);
  if (!pts.length) return <svg viewBox={`0 0 ${W} ${H}`} className="w-full" />;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${sx(i)} ${sy(p.value)}`).join(' ');
  const area = `${d} L ${sx(pts.length - 1)} ${H - pad} L ${sx(0)} ${H - pad} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={'Line chart: ' + pts.map((p) => `${p.label} ${p.value}`).join(', ')}
    >
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={sx(i)} cy={sy(p.value)} r="3" fill={color} />)}
    </svg>
  );
};

const PieChart: React.FC<Props> = ({ data }) => {
  const pts = asPoints(data);
  const total = pts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const cx = 80, cy = 80, r = 64, ir = 38;
  let a0 = -Math.PI / 2;
  const seg = pts.map((p, i) => {
    const frac = Math.max(0, p.value) / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`;
    a0 = a1;
    return { d, c: safeColor(p.color, PALETTE[i % PALETTE.length]), label: p.label, value: p.value };
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg
        width="160"
        height="160"
        viewBox="0 0 160 160"
        role="img"
        aria-label={'Pie chart: ' + pts.map((p) => `${p.label} ${p.value}`).join(', ')}
      >
        {seg.map((s, i) => <path key={i} d={s.d} fill={s.c} />)}
      </svg>
      <div className="flex flex-col gap-1 text-xs">
        {seg.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded" style={{ background: s.c }} />
            <span className="text-muted">{s.label}</span>
            <span className="tabular-nums text-ink">{fmt(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ===== Input (write to state) ============================================
const Slider: React.FC<Props> = ({ label, stateKey, min = 0, max = 100, step = 1, prefix = '', suffix = '' }) => {
  const { state, setVar } = useGenState();
  const modelMin = Number(min);
  const modelMax = Number(max);
  const stepN = Number(step) || 1;
  const val = typeof state[stateKey] === 'number' ? (state[stateKey] as number) : modelMin;
  const bounds = sliderBounds(modelMin, modelMax, val);
  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    setVar(stateKey, raw);
  };
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="flex items-center font-medium text-ink">
          {prefix ? <span>{prefix}</span> : null}
          <input
            type="number"
            aria-label={typeof label === 'string' ? `${label} value` : 'Value'}
            className="w-24 bg-transparent text-right outline-none"
            step="any"
            value={Number.isFinite(val) ? val : 0}
            onChange={(e) => commit(Number(e.target.value))}
          />
          {suffix ? <span>{suffix}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-accent"
        min={bounds.min}
        max={bounds.max}
        step={isStepAligned(val, bounds.min, stepN) ? stepN : 'any'}
        value={val}
        onChange={(e) => commit(Number(e.target.value))}
      />
      {bounds.widened && (
        <p className="mt-1 text-[11px] text-muted">
          Outside the suggested {modelMin}–{modelMax}. Showing {prefix}{val}{suffix}; the slider includes it.
        </p>
      )}
    </label>
  );
};

const NumberInput: React.FC<Props> = ({ label, stateKey, min, max, step = 1 }) => {
  const { state, setVar } = useGenState();
  const val = typeof state[stateKey] === 'number' ? (state[stateKey] as number) : 0;
  const lo = min == null ? null : Number(min);
  const hi = max == null ? null : Number(max);
  const outside = (lo != null && val < lo) || (hi != null && val > hi);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      <input
        type="number"
        className="w-full rounded-lg border border-edge bg-canvas/60 px-3 py-2 text-ink outline-none focus:border-accent"
        step="any"
        value={val}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setVar(stateKey, n);
        }}
      />
      {outside && (
        <p className="mt-1 text-[11px] text-muted">
          Outside the suggested {lo ?? '…'}–{hi ?? '…'}. Showing {val} (step {step} is not applied to typed values).
        </p>
      )}
    </label>
  );
};

const TextInput: React.FC<Props> = ({ label, stateKey, placeholder }) => {
  const { state, setVar } = useGenState();
  const val = typeof state[stateKey] === 'string' ? (state[stateKey] as string) : '';
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      <input type="text" value={val} placeholder={placeholder} onChange={(e) => setVar(stateKey, e.target.value)} className="w-full rounded-lg border border-edge bg-canvas/60 px-3 py-2 text-ink outline-none focus:border-accent" />
    </label>
  );
};

const Toggle: React.FC<Props> = ({ label, stateKey }) => {
  const { state, setVar } = useGenState();
  const on = Boolean(state[stateKey]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => setVar(stateKey, !on)}
      className="flex w-full items-center justify-between gap-3 text-sm text-muted"
    >
      <span>{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-edge'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
};

const Select: React.FC<Props> = ({ label, stateKey, options }) => {
  const { state, setVar } = useGenState();
  const opts = Array.isArray(options) ? options : [];
  const cur = state[stateKey];
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      <select
        className="w-full rounded-lg border border-edge bg-canvas/60 px-3 py-2 text-ink outline-none focus:border-accent"
        value={cur === undefined || cur === null ? '' : String(cur)}
        onChange={(e) => {
          const o = opts.find((x) => String(x?.value) === e.target.value);
          setVar(stateKey, o ? o.value : e.target.value);
        }}
      >
        {opts.map((o, i) => <option key={i} value={String(o?.value)}>{String(o?.label ?? o?.value)}</option>)}
      </select>
    </label>
  );
};

const RadioGroup: React.FC<Props> = ({ label, stateKey, options }) => {
  const { state, setVar } = useGenState();
  const opts = Array.isArray(options) ? options : [];
  const cur = state[stateKey];
  return (
    <div className="text-sm">
      {label && <div className="mb-1 text-muted">{label}</div>}
      <div role="radiogroup" aria-label={typeof label === 'string' && label ? label : 'Options'} className="flex flex-wrap gap-2">
        {opts.map((o, i) => {
          const sel = String(cur) === String(o?.value);
          return (
            <button key={i} type="button" role="radio" aria-checked={sel} onClick={() => setVar(stateKey, o.value)} className={`rounded-lg border px-3 py-1.5 ${sel ? 'border-accent bg-accent/15 text-ink' : 'border-edge text-muted hover:text-ink'}`}>
              {String(o?.label ?? o?.value)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ColorPicker: React.FC<Props> = ({ label, stateKey }) => {
  const { state, setVar } = useGenState();
  const cur = typeof state[stateKey] === 'string' ? (state[stateKey] as string) : '#7c5cff';
  return (
    <label className="flex items-center justify-between text-sm text-muted">
      <span>{label}</span>
      <input type="color" value={cur} onChange={(e) => setVar(stateKey, e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-edge bg-transparent" />
    </label>
  );
};

const Swatch: React.FC<Props> = ({ label, stateKey, color }) => {
  const { state } = useGenState();
  const c = stateKey && typeof state[stateKey] === 'string' ? (state[stateKey] as string) : color || '#7c5cff';
  return (
    <div className="flex items-center gap-3">
      <span className="h-12 w-12 rounded-lg border border-edge" style={{ background: c }} />
      <div>
        <div className="text-sm text-ink">{label || 'Color'}</div>
        <div className="font-mono text-xs text-muted">{c}</div>
      </div>
    </div>
  );
};

// ===== Action =============================================================
const Button: React.FC<Props> = ({ label, action, variant = 'solid' }) => {
  const { dispatch } = useGenState();
  const base = 'rounded-lg px-4 py-2 text-sm font-medium transition-colors';
  const styles =
    variant === 'ghost'
      ? 'border border-edge text-muted hover:text-ink hover:border-accent'
      : 'bg-accent text-accent-ink hover:bg-accent-deep';
  return (
    <button type="button" className={`${base} ${styles}`} onClick={() => action && dispatch(action as UIAction)}>
      {label}
    </button>
  );
};

// ===== Sandboxed escape hatch ============================================
const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'";
// The artifact iframe is an opaque origin (sandbox=allow-scripts, no allow-same-origin),
// so it cannot read the parent page. Two runtime needs still have to be allowed
// *inside that frame*: Babel's `new Function` ('unsafe-eval') and the module lane's
// `import(blob:)` ('blob:'). connect-src is the CDN hosts plus the public data APIs
// named in the system prompt — not every https origin.
const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: https://unpkg.com https://cdn.tailwindcss.com https://esm.sh",
  "style-src 'unsafe-inline' https://cdn.tailwindcss.com",
  "img-src data: blob: https://unpkg.com https://cdn.tailwindcss.com https://esm.sh",
  "font-src data: https://cdn.tailwindcss.com https://esm.sh",
  "connect-src https://unpkg.com https://cdn.tailwindcss.com https://esm.sh https://api.open-meteo.com https://api.coingecko.com https://api.github.com",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function neutralizeClosers(source: string): string {
  return source.replace(/<\/(script|style)/gi, '<\\/$1');
}

/** Self-contained document for Lane B. CSP blocks network, matching the prompt. */
export function customWidgetSrcDoc(html: string, css: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}"><style>${neutralizeClosers(css)}</style></head><body>${html}` +
    `<scr` + `ipt>${neutralizeClosers(script)}</scr` + `ipt>` +
    `<scr` + `ipt>${TEXT_POSTER}</scr` + `ipt></body></html>`;
}

const CustomWidget: React.FC<Props> = ({ html = '', css = '', script = '', height = 240 }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (ref.current && e.source === ref.current.contentWindow && e.data && typeof e.data.__artifactText === 'string') {
        ref.current.dataset.artifactText = e.data.__artifactText;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const srcDoc = customWidgetSrcDoc(String(html), String(css), String(script));
  return (
    <iframe
      ref={ref}
      title="custom-widget"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="w-full rounded-xl border border-edge bg-canvas"
      style={{ height: Number(height) }}
    />
  );
};

// ===== Freeform React/Tailwind lane (sandboxed, CDN runtime) =============
// The model writes a real React component (`function App(){…}`) using Tailwind.
// It is transpiled by Babel and rendered inside an isolated iframe
// (sandbox="allow-scripts", no same-origin) so it cannot touch the parent page.
// React/ReactDOM/Babel/Tailwind load from CDN. The iframe posts its content
// height back so the frame auto-sizes to the design.
// Posts a text digest of the iframe's content to the parent, so the voice agent's
// read_ui can "see" inside the otherwise cross-origin sandbox.
const TEXT_POSTER =
  'var __lt=0;function __pt(){try{var n=Date.now();if(n-__lt<700)return;__lt=n;parent.postMessage({__artifactText:(document.body.innerText||"").replace(/\\s+/g," ").trim().slice(0,3000)},"*");}catch(e){}}setTimeout(__pt,800);setTimeout(__pt,2500);try{new MutationObserver(__pt).observe(document.documentElement,{subtree:true,childList:true,characterData:true});}catch(e){}';

// A sandbox without allow-same-origin throws on localStorage/sessionStorage and
// has no nice way to surface errors. Install in-memory storage shims + a small
// error reporter; shared by both runtimes.
const ARTIFACT_SHIM =
  'window.__err=function(m){var r=document.getElementById("root");if(r){r.innerHTML="";var p=document.createElement("pre");p.style.cssText="color:#f87171;padding:16px;font:12px ui-monospace,monospace;white-space:pre-wrap";p.textContent=String(m);r.appendChild(p);}};' +
  'window.addEventListener("error",function(e){window.__err((e&&e.message)||String(e));});' +
  'window.addEventListener("unhandledrejection",function(e){window.__err((e&&e.reason&&e.reason.message)||String(e&&e.reason));});' +
  'try{var _mk=function(){var m={};var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];},clear:function(){m={};},key:function(i){return Object.keys(m)[i]||null;}};Object.defineProperty(s,"length",{get:function(){return Object.keys(m).length;}});return s;};' +
  'Object.defineProperty(window,"localStorage",{configurable:true,value:_mk()});Object.defineProperty(window,"sessionStorage",{configurable:true,value:_mk()});}catch(e){}' +
  TEXT_POSTER;

const escScript = (code: string): string => JSON.stringify(code).replace(/<\//g, '<\\/');

// Classic lane: global React UMD + Babel classic. Hooks are pre-destructured;
// no import/export. Best for small self-contained components. Auto-resizes.
function buildClassicDoc(code: string): string {
  const prelude =
    'const {useState,useEffect,useRef,useMemo,useCallback,useReducer}=React;' +
    'class ErrorBoundary extends React.Component{constructor(p){super(p);this.state={err:0};}static getDerivedStateFromError(){return {err:1};}componentDidCatch(e){window.__err&&window.__err((e&&e.message)||e);}render(){return this.state.err?null:this.props.children;}}';
  const epilogue =
    'const _r=ReactDOM.createRoot(document.getElementById("root"));_r.render(React.createElement(ErrorBoundary,null,React.createElement(App)));' +
    'function _ph(){try{parent.postMessage({__artifactHeight:document.documentElement.scrollHeight},"*");}catch(e){}}try{new ResizeObserver(_ph).observe(document.body);}catch(e){}setTimeout(_ph,60);setTimeout(_ph,500);';
  const runner =
    'try{var _src=' + escScript(code) + ';var _full=' + JSON.stringify(prelude) + '+"\\n"+_src+"\\n"+' + JSON.stringify(epilogue) + ';' +
    'var _out=Babel.transform(_full,{presets:[["react",{runtime:"classic"}]]}).code;new Function(_out)();}catch(e){window.__err((e&&e.message)||e);}';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` +
    '<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>' +
    '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>' +
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>' +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<style>html,body{margin:0;background:transparent}#root{min-height:100%}</style>' +
    '</head><body><div id="root"></div><script>' + ARTIFACT_SHIM + '</script><script>' + runner + '</script></body></html>';
}

// Module lane: import maps + esm.sh, Babel automatic, run as a blob module.
// Lets the model `import` real npm packages (lucide-react, hls.js, framer-motion).
function buildModuleDoc(code: string): string {
  const importMap = JSON.stringify({
    imports: {
      react: 'https://esm.sh/react@18.3.1',
      'react-dom': 'https://esm.sh/react-dom@18.3.1',
      'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
      'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
      'lucide-react': 'https://esm.sh/lucide-react@0.439.0?external=react',
      'hls.js': 'https://esm.sh/hls.js@1.5.15',
      'framer-motion': 'https://esm.sh/framer-motion@11?external=react,react-dom',
      // charts / dataviz
      recharts: 'https://esm.sh/recharts@2?external=react,react-dom',
      d3: 'https://esm.sh/d3@7',
      // 3D
      three: 'https://esm.sh/three@0.160.0',
      '@react-three/fiber': 'https://esm.sh/@react-three/fiber@8?external=react,react-dom,three',
      // drag & drop
      '@dnd-kit/core': 'https://esm.sh/@dnd-kit/core@6?external=react,react-dom',
      '@dnd-kit/sortable': 'https://esm.sh/@dnd-kit/sortable@8?external=react,react-dom',
      '@dnd-kit/utilities': 'https://esm.sh/@dnd-kit/utilities@3?external=react',
      // misc utilities
      gsap: 'https://esm.sh/gsap@3',
      'react-markdown': 'https://esm.sh/react-markdown@9?external=react',
      'date-fns': 'https://esm.sh/date-fns@3',
      'canvas-confetti': 'https://esm.sh/canvas-confetti@1',
      clsx: 'https://esm.sh/clsx@2',
      zustand: 'https://esm.sh/zustand@4?external=react',
      'react-icons/': 'https://esm.sh/react-icons@5.3.0/',
    },
  });
  const mount = "\n;import { createRoot as __cr } from 'react-dom/client';\n__cr(document.getElementById('root')).render(<App/>);";
  const runner =
    'try{var _src=' + escScript(code) + ';var _full=_src+' + JSON.stringify(mount) + ';' +
    'var _out=Babel.transform(_full,{presets:[["react",{runtime:"automatic"}]],filename:"app.jsx"}).code;' +
    'var _u=URL.createObjectURL(new Blob([_out],{type:"text/javascript"}));import(_u).catch(function(e){window.__err((e&&e.message)||String(e));});}catch(e){window.__err((e&&e.message)||e);}';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>' +
    '<script type="importmap">' + importMap + '</script>' +
    '<style>html,body{margin:0;background:transparent;height:100%}#root{height:100%;min-height:100%}</style>' +
    '</head><body><div id="root"></div><script>' + ARTIFACT_SHIM + '</script><script>' + runner + '</script></body></html>';
}

export function buildArtifactDoc(code: string): string {
  // ES `import` statements → module lane; otherwise the simple classic lane.
  const usesImports = /(^|[\n;])\s*import\s.+from\s/.test(code) || /(^|[\n;])\s*import\s+['"]/.test(code);
  return usesImports ? buildModuleDoc(code) : buildClassicDoc(code);
}

const ReactArtifact: React.FC<Props> = ({ code = '', height = 480 }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState<number>(Number(height) || 480);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow || !e.data) return;
      if (typeof e.data.__artifactHeight === 'number') setH(Math.max(80, Math.min(2400, Math.round(e.data.__artifactHeight))));
      if (typeof e.data.__artifactText === 'string') ref.current.dataset.artifactText = e.data.__artifactText;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <iframe
      ref={ref}
      title="react-artifact"
      sandbox="allow-scripts"
      allow="autoplay; fullscreen; encrypted-media"
      allowFullScreen
      referrerPolicy="no-referrer"
      srcDoc={buildArtifactDoc(String(code))}
      className="w-full rounded-xl border border-edge bg-canvas"
      style={{ height: h }}
    />
  );
};

export const registry: Record<string, React.FC<Props>> = {
  // layout
  Stack, Row, Grid, Card, Tabs, Collapsible, Divider,
  // display
  Heading, Text, Stat, Badge, List, KeyValue, ProgressBar, Gauge,
  // charts
  BarChart, LineChart, PieChart,
  // input
  Slider, NumberInput, TextInput, Toggle, Select, RadioGroup, ColorPicker, Swatch,
  // action
  Button,
  // sandboxed escape hatches
  CustomWidget,
  ReactArtifact,
};
