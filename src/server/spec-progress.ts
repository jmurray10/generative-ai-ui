/**
 * Reads a UISpec as the model streams it, so the client can show what is
 * actually happening during the long generation call instead of a spinner.
 *
 * It is a tiny incremental JSON tokenizer: it tracks nesting and strings, notices
 * when the top-level `design` object closes (the brief is shown early) and when
 * each top-level `tree` item closes (one more part written). It never repairs or
 * validates; the finished text still goes through `validateSpec`.
 */
import type { UIDesign } from '../shared/spec.ts';

export type BuildPhase = 'planning' | 'thinking' | 'design' | 'setup' | 'building' | 'finishing';

export interface BuildPart {
  type: string;
  label: string;
}

export interface BuildProgress {
  phase: BuildPhase;
  /** Characters of spec JSON written so far. */
  chars: number;
  /** Top-level parts completed so far. */
  parts: number;
  /** Most recently completed part. */
  part?: BuildPart;
  /** Set once, when the design brief is complete. */
  design?: UIDesign;
  /** Set once, when the title is known. */
  title?: string;
}

const TOP_PHASE: Record<string, BuildPhase> = {
  design: 'design',
  title: 'setup',
  initialState: 'setup',
  theme: 'setup',
  tree: 'building',
};

function partOf(json: string): BuildPart | undefined {
  try {
    const node = JSON.parse(json) as { type?: unknown; props?: Record<string, unknown> };
    if (typeof node.type !== 'string') return undefined;
    const p = node.props ?? {};
    const label = [p.title, p.label, p.heading, p.text].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    return { type: node.type, label: label ? label.slice(0, 60) : '' };
  } catch {
    return undefined;
  }
}

export class SpecScanner {
  private buf = '';
  private stack: string[] = [];
  private inStr = false;
  private esc = false;
  private strStart = -1;
  private lastKey = '';
  private topKey = '';
  private designStart = -1;
  private partStart = -1;
  private titleStart = -1;
  private treeDone = false;
  private parts = 0;
  private sentDesign = false;
  private sentTitle = false;

  /** Feed a chunk; returns the progress events this chunk produced (often none). */
  push(chunk: string): BuildProgress[] {
    const out: BuildProgress[] = [];
    const from = this.buf.length;
    this.buf += chunk;
    for (let i = from; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') {
          this.inStr = false;
          const text = this.buf.slice(this.strStart + 1, i);
          if (this.stack.length === 1 && this.titleStart === this.strStart && !this.sentTitle) {
            this.sentTitle = true;
            out.push({ ...this.snapshot(), title: safeUnescape(text) });
          }
          this.lastKey = text;
        }
        continue;
      }
      if (c === '"') {
        this.inStr = true;
        this.strStart = i;
        if (this.stack.length === 1 && this.topKey === 'title' && this.titleStart === -2) this.titleStart = i;
        continue;
      }
      if (c === ':' && this.stack.length === 1) {
        this.topKey = this.lastKey;
        if (this.topKey === 'title') this.titleStart = -2; // the next string opens the title value
        out.push(this.snapshot());
        continue;
      }
      if (c === '{' || c === '[') {
        this.stack.push(c);
        if (this.stack.length === 2 && this.topKey === 'design' && c === '{') this.designStart = i;
        if (this.stack.length === 3 && this.topKey === 'tree' && this.stack[1] === '[' && c === '{') this.partStart = i;
        continue;
      }
      if (c === '}' || c === ']') {
        const depth = this.stack.length;
        this.stack.pop();
        if (depth === 2 && this.topKey === 'design' && this.designStart >= 0 && !this.sentDesign) {
          this.sentDesign = true;
          try {
            const design = safeDesign(JSON.parse(this.buf.slice(this.designStart, i + 1)));
            if (design) out.push({ ...this.snapshot(), design });
          } catch { /* partial or odd brief: the final spec still carries it */ }
        }
        if (depth === 3 && this.topKey === 'tree' && this.partStart >= 0) {
          this.parts++;
          out.push({ ...this.snapshot(), part: partOf(this.buf.slice(this.partStart, i + 1)) });
          this.partStart = -1;
        }
        if (depth === 2 && this.topKey === 'tree') {
          this.treeDone = true;
          out.push(this.snapshot());
        }
      }
    }
    return out;
  }

  snapshot(): BuildProgress {
    const phase: BuildPhase = this.buf.trim() === ''
      ? 'thinking'
      : this.treeDone ? 'finishing' : TOP_PHASE[this.topKey] ?? (this.topKey ? 'setup' : 'design');
    return { phase, chars: this.buf.length, parts: this.parts };
  }

  get text(): string {
    return this.buf;
  }
}

const HEX = /^#[0-9a-f]{3,8}$/i;
const clipText = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

/**
 * The early brief is model output on its way to the parent page (palette swatches are
 * rendered as CSS backgrounds), so keep only plain text and hex colors, the same rules
 * `normDesign` applies to the final spec. A `url(...)` "color" never reaches the page.
 */
function safeDesign(raw: unknown): UIDesign | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const palette = Array.isArray(d.palette) ? d.palette.filter((c): c is string => typeof c === 'string' && HEX.test(c.trim())).slice(0, 8) : [];
  const design: UIDesign = {
    ...(clipText(d.direction, 80) ? { direction: clipText(d.direction, 80) } : {}),
    ...(clipText(d.fonts, 120) ? { fonts: clipText(d.fonts, 120) } : {}),
    ...(palette.length ? { palette } : {}),
    ...(clipText(d.signature, 240) ? { signature: clipText(d.signature, 240) } : {}),
  };
  return Object.keys(design).length ? design : undefined;
}

function safeUnescape(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}
