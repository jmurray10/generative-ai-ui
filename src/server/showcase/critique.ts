/**
 * Showcase A: the self-critiquing generator.
 *
 * Round 0: grok-4.7 builds a sandboxed-React UI from the prompt with NO DESIGN.md.
 * Each round: Impeccable 4.8.0 `detect` scans the rendered artifact (URL mode, at
 * a stable preview URL) and the source (dir mode, for file:line). Grok gets the
 * compacted findings plus the DESIGN.md and returns a full revision.
 * Stop at 0 findings, after 3 fix rounds, or when a round doesn't reduce the count.
 * Nothing is planted: round 0 is whatever the model produced.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UINode, UISpec } from '../../shared/spec.ts';
import type { DesignSystem } from '../../shared/toolbox.ts';
import { designMarkdown } from '../design-systems.ts';
import { grokJSON } from '../grok-json.ts';
import type { Generator } from '../types.ts';

export interface Finding {
  antipattern: string;
  name?: string;
  description?: string;
  severity?: string;
  category?: string;
  file?: string;
  line?: number;
  snippet?: string;
  selector?: string;
  advisory?: boolean;
}

export interface CompactGroup { antipattern: string; name: string; severity: string; count: number; snippets: string[] }
export interface Compacted { count: number; groups: CompactGroup[]; descriptions: Record<string, string> }

/** Advisory findings never count (Impeccable keeps them out of the failure count too). */
export const counted = (f: Finding[]) => f.filter((x) => !x.advisory && x.severity !== 'advisory');

/** Group by antipattern; keep up to 3 snippets each; each description once. */
export function compactFindings(findings: Finding[]): Compacted {
  const groups = new Map<string, CompactGroup>();
  const descriptions: Record<string, string> = {};
  for (const f of counted(findings)) {
    const g = groups.get(f.antipattern) ?? { antipattern: f.antipattern, name: f.name ?? f.antipattern, severity: f.severity ?? 'warning', count: 0, snippets: [] };
    g.count += 1;
    if (g.snippets.length < 3) {
      const where = f.selector ? ` @ ${f.selector}` : f.line ? ` @ App.jsx:${f.line}` : '';
      g.snippets.push(`${(f.snippet ?? '').slice(0, 140)}${where}`);
    }
    groups.set(f.antipattern, g);
    if (f.description && !descriptions[f.antipattern]) descriptions[f.antipattern] = f.description;
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count);
  return { count: list.reduce((s, g) => s + g.count, 0), groups: list, descriptions };
}

export interface RoundSummary { round: number; urlCount: number | null; dirCount: number; count: number }

/** Brief rule: stop at 0, at the round cap, or when a round did not reduce the count. */
export function shouldStop(history: RoundSummary[], maxFixRounds = 3): { stop: boolean; why: string } {
  const last = history.at(-1);
  if (!last) return { stop: false, why: '' };
  if (last.count === 0) return { stop: true, why: 'clean: 0 findings' };
  if (history.length >= 2 && last.count >= history[history.length - 2].count) return { stop: true, why: `round ${last.round} did not reduce the count` };
  if (last.round >= maxFixRounds) return { stop: true, why: `reached ${maxFixRounds} fix rounds` };
  return { stop: false, why: '' };
}

export function bestRound(history: RoundSummary[]): RoundSummary | undefined {
  return history.reduce<RoundSummary | undefined>((b, r) => (!b || r.count < b.count ? r : b), undefined);
}

export function findArtifactCode(nodes: UINode[] | undefined): string | null {
  for (const n of nodes ?? []) {
    if (n.type === 'ReactArtifact' && typeof n.props?.code === 'string') return n.props.code as string;
    const inner = findArtifactCode(n.children);
    if (inner) return inner;
  }
  return null;
}

// ---- preview store: a stable URL per round so the detector sees the real render
const previews = new Map<string, string>();
export function putPreview(code: string): string {
  const id = randomUUID();
  previews.set(id, code);
  if (previews.size > 60) previews.delete(previews.keys().next().value as string);
  return id;
}
export const getPreview = (id: string) => previews.get(id);

const WORK = mkdtempSync(join(tmpdir(), 'genui-critique-'));

export function runDetect(target: string, viewport = '1280x800', timeoutMs = 120_000): Promise<Finding[]> {
  const bin = process.env.IMPECCABLE_BIN?.trim();
  const [cmd, args] = bin ? [bin, ['detect']] : ['npx', ['--yes', 'impeccable@4.8.0', 'detect']];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, target, '--json', '--viewport', viewport], { cwd: WORK, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('impeccable detect timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const start = out.indexOf('[');
      try {
        const parsed = JSON.parse(start >= 0 ? out.slice(start) : out);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        resolve(parsed as Finding[]);
      } catch {
        reject(new Error(`impeccable detect returned no JSON: ${(err || out).slice(0, 200)}`));
      }
    });
  });
}

const FIX_SYSTEM = `You are revising a generated UI so it passes a design-quality detector and follows the attached DESIGN.md. You get the current UI, the detector findings as JSON, and the DESIGN.md. Fix every finding at its root: change the token, component or class that causes it, not just the one instance. Do not add features, change content, or alter layout beyond what a fix requires. Never suppress the detector with comments, renamed classes or hidden elements. If a finding conflicts with DESIGN.md, follow DESIGN.md and say so. Return two things: (1) the complete revised UI in the same format you received, and (2) a JSON list {antipattern, what you changed, where} for each finding, plus any finding you could not fix and why.
The UI is a self-contained React component (function App(){...}) rendered in a sandbox with Tailwind loaded; keep that contract. Put the full revised source in "code".`;

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    changes: { type: 'array', items: { type: 'object', properties: { antipattern: { type: 'string' }, change: { type: 'string' }, where: { type: 'string' } }, required: ['antipattern', 'change'], additionalProperties: false } },
    unfixed: { type: 'array', items: { type: 'object', properties: { antipattern: { type: 'string' }, why: { type: 'string' } }, required: ['antipattern', 'why'], additionalProperties: false } },
  },
  required: ['code', 'changes'],
  additionalProperties: false,
};

export interface FixResult { code: string; changes: { antipattern: string; change: string; where?: string }[]; unfixed?: { antipattern: string; why: string }[] }

export async function fixRound(code: string, compacted: Compacted, round: number, designMd: string): Promise<FixResult> {
  const input = `DESIGN.md:\n<<<\n${designMd}\n>>>\nCurrent UI (react):\n<<<\n${code}\n>>>\nDetector findings, round ${round}, ${compacted.count} total:\n<<<\n${JSON.stringify(compacted)}\n>>>\nRevise and return as instructed.`;
  const r = await grokJSON<FixResult>({ instructions: FIX_SYSTEM, input, schemaName: 'ui_revision', schema: FIX_SCHEMA, maxTokens: 16384 });
  if (typeof r.code !== 'string' || !/function\s+App|const\s+App/.test(r.code)) throw new Error('revision did not return an App component');
  return r;
}

export type CritiqueEvent =
  | { type: 'status'; text: string }
  | { type: 'round'; round: number; previewId: string; code: string; urlCount: number | null; dirCount: number; count: number; compacted: Compacted; changes?: FixResult['changes']; unfixed?: FixResult['unfixed']; detectError?: string }
  | { type: 'done'; history: RoundSummary[]; best: number; stopReason: string; summary: string }
  | { type: 'error'; error: string };

export interface CritiqueArgs {
  prompt: string;
  designSystem: DesignSystem;
  generator: Generator;
  previewBase: string; // e.g. http://127.0.0.1:8080
  emit: (e: CritiqueEvent) => void;
  maxFixRounds?: number;
  signal?: AbortSignal;
}

async function detectBoth(code: string, previewBase: string, round: number) {
  const id = putPreview(code);
  const dir = join(WORK, `${id}-r${round}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'App.jsx'), code);
  const [url, src] = await Promise.allSettled([runDetect(`${previewBase}/api/showcase/artifact/${id}`), runDetect(dir)]);
  const urlF = url.status === 'fulfilled' ? url.value : null;
  const dirF = src.status === 'fulfilled' ? src.value : [];
  const detectError = [url, src].filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message ?? r)).join('; ') || undefined;
  const urlCount = urlF ? counted(urlF).length : null;
  const dirCount = counted(dirF).length;
  // The rendered page is the source of truth; fall back to the source scan only if the URL scan failed.
  const count = urlCount ?? dirCount;
  return { id, compacted: compactFindings([...(urlF ?? []), ...dirF]), urlCount, dirCount, count, detectError };
}

export function summarize(history: RoundSummary[], stopReason: string, design: DesignSystem): string {
  const counts = history.map((h) => `round ${h.round}: ${h.count}`).join(', ');
  const best = bestRound(history);
  return `Impeccable findings by round (rendered page): ${counts}. Stopped because ${stopReason}. Best was round ${best?.round} with ${best?.count}. Fixes followed the ${design.replace('_', ' ')} DESIGN.md.`;
}

export async function critiqueLoop({ prompt, designSystem, generator, previewBase, emit, maxFixRounds = 3, signal }: CritiqueArgs): Promise<void> {
  const designMd = designMarkdown(designSystem);
  emit({ type: 'status', text: 'Round 0: generating with no DESIGN.md…' });
  const spec: UISpec = await generator.generate(prompt, { lane: 'sandboxed_react' });
  let code = findArtifactCode(spec.tree);
  if (!code) throw new Error('round 0 did not return a ReactArtifact');
  const history: RoundSummary[] = [];
  let changes: FixResult['changes'] | undefined;
  let unfixed: FixResult['unfixed'] | undefined;
  for (let round = 0; ; round++) {
    if (signal?.aborted) return;
    emit({ type: 'status', text: `Round ${round}: running impeccable detect…` });
    const d = await detectBoth(code, previewBase, round);
    history.push({ round, urlCount: d.urlCount, dirCount: d.dirCount, count: d.count });
    emit({ type: 'round', round, previewId: d.id, code, urlCount: d.urlCount, dirCount: d.dirCount, count: d.count, compacted: d.compacted, changes, unfixed, detectError: d.detectError });
    const stop = shouldStop(history, maxFixRounds);
    if (stop.stop) {
      const best = bestRound(history)!;
      emit({ type: 'done', history, best: best.round, stopReason: stop.why, summary: summarize(history, stop.why, designSystem) });
      return;
    }
    emit({ type: 'status', text: `Round ${round + 1}: Grok is fixing ${d.compacted.count} findings…` });
    const fix = await fixRound(code, d.compacted, round, designMd);
    code = fix.code;
    changes = fix.changes;
    unfixed = fix.unfixed;
  }
}
