/**
 * Evaluate (and tune) the Jev router on the labelled prompts in scripts/jev-prompts.json.
 *
 *   npx tsx scripts/jev-eval.ts                      # tune + showcase, current thresholds
 *   npx tsx scripts/jev-eval.ts --heldout            # also score the held-out split (final report only)
 *   npx tsx scripts/jev-eval.ts --sweep              # grid-search thresholds on the TUNE split only
 *   npx tsx scripts/jev-eval.ts --t '{"PICK":0.5}'   # try overrides
 *
 * Needs TYPESAFE_API_KEY. Raw Jev answers are cached per (model, questions, prompt) in
 * scripts/screens/jev-cache/, so threshold sweeps do not call the API again. Results go to
 * scripts/screens/jev-eval.json. The key is never printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { askJev } from '../src/server/jev/client.ts';
import { routeToolbox, type Answers, type Thresholds } from '../src/server/jev/policy.ts';
import { JEV_MODEL, Q, REGISTRY_NAMES, T } from '../src/server/jev/router.questions.ts';
import type { Decision } from '../src/shared/toolbox.ts';

interface Item { id: string; prompt: string; expect: string; design?: string; answered?: boolean; split: 'tune' | 'heldout' | 'showcase' }

const SHOWCASE: Item[] = [
  { id: 'show-workbench', split: 'showcase', expect: 'route', prompt: 'A review workbench for contract analysts: a queue of submitted documents, a document viewer with highlighted citations, and an AI answer panel that links every claim back to page and line.' },
  { id: 'show-wizard', split: 'showcase', expect: 'route', prompt: "A multi-step vendor onboarding wizard for procurement staff: extract fields from a vendor's email with confidence flags, fix gaps, review a provisional risk tier, then approve or send back." },
  { id: 'show-library', split: 'showcase', expect: 'route', prompt: "A monthly report for a neighborhood library's members: total book loans, the top five genres as a bar chart, and a short note from the head librarian." },
  { id: 'show-critique-vague', split: 'showcase', expect: 'ask', prompt: 'a modern SaaS analytics dashboard' },
];

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const model = process.env.TYPESAFE_DEFAULT_MODEL?.trim() || JEV_MODEL;
const qHash = createHash('sha256').update(JSON.stringify({ model, Q, REGISTRY_NAMES })).digest('hex').slice(0, 12);
const cacheDir = new URL(`./screens/jev-cache/${qHash}/`, import.meta.url);
mkdirSync(cacheDir, { recursive: true });

const data = JSON.parse(readFileSync(new URL('./jev-prompts.json', import.meta.url), 'utf8')) as { items: Item[] };
const items: Item[] = [...data.items, ...SHOWCASE];

async function answersFor(it: Item): Promise<{ answers: Answers | null; ms: number; error?: string; cached: boolean }> {
  const f = new URL(createHash('sha256').update(it.prompt).digest('hex').slice(0, 16) + '.json', cacheDir);
  if (existsSync(f)) return { ...JSON.parse(readFileSync(f, 'utf8')), cached: true };
  const t0 = Date.now();
  try {
    const { answers } = await askJev(it.prompt, { ...process.env, TYPESAFE_TIMEOUT_MS: '15000' });
    const rec = { answers, ms: Date.now() - t0 };
    writeFileSync(f, JSON.stringify(rec));
    return { ...rec, cached: false };
  } catch (err) {
    return { answers: null, ms: Date.now() - t0, error: (err as Error).message, cached: false };
  }
}

const brief = (d: Decision) => (d.kind === 'route' ? 'route' : d.kind === 'ask' ? 'ask' : `hold:${d.reason}`);
const correct = (it: Item, d: Decision) => brief(d) === it.expect;

const raw = new Map<string, Awaited<ReturnType<typeof answersFor>>>();
for (let i = 0; i < items.length; i += 4) {
  const batch = items.slice(i, i + 4);
  const res = await Promise.all(batch.map(answersFor));
  batch.forEach((it, j) => raw.set(it.id, res[j]));
}
const errors = [...raw.entries()].filter(([, r]) => r.error);
if (errors.length) console.log(`Jev errors: ${errors.map(([id, r]) => `${id}: ${r.error}`).join('; ')}`);

function score(t: Thresholds, split: Item['split']) {
  const rows = items.filter((it) => it.split === split).map((it) => {
    const r = raw.get(it.id)!;
    const d = routeToolbox(r.answers, r.error, { answered: !!it.answered }, t);
    return { it, d, ok: correct(it, d) };
  });
  return { rows, acc: rows.filter((r) => r.ok).length / (rows.length || 1) };
}

let t: Thresholds = { ...T, ...(opt('--t') ? JSON.parse(opt('--t')!) : {}) };

if (flag('--sweep')) {
  const grid: Partial<Record<keyof Thresholds, number[]>> = {
    PICK: [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7],
    PICK_AFTER: [0.3, 0.4, 0.5, 0.6],
    DESIGN_UNCLEAR: [0.3, 0.4, 0.5, 0.6, 1.01],
    RENDER_PICK: [0.5, 0.55, 0.6, 0.7],
    MARGIN: [1.0, 1.2, 1.4, 1.5, 1.6],
    MISSING: [0.5, 0.6, 0.7, 0.8],
    INJECT: [0.3, 0.5, 0.7],
    CONTRADICT: [0.4, 0.5, 0.6, 0.7],
  };
  const keys = Object.keys(grid) as (keyof Thresholds)[];
  let best: { t: Thresholds; acc: number; dist: number }[] = [];
  const walk = (i: number, cur: Thresholds) => {
    if (i === keys.length) {
      const acc = score(cur, 'tune').acc;
      // Tie-break toward the defaults so we move thresholds only when the tune split says so.
      const dist = keys.reduce((s, k) => s + Math.abs(cur[k] - T[k]), 0);
      best.push({ t: cur, acc, dist });
      if (best.length > 4000) { best.sort((a, b) => b.acc - a.acc || a.dist - b.dist); best = best.slice(0, 50); }
      return;
    }
    for (const v of grid[keys[i]]!) walk(i + 1, { ...cur, [keys[i]]: v });
  };
  walk(0, t);
  best.sort((a, b) => b.acc - a.acc || a.dist - b.dist);
  console.log('Top thresholds on TUNE split:');
  for (const b of best.slice(0, 8)) console.log(`  tune ${(b.acc * 100).toFixed(1)}%  ${JSON.stringify(Object.fromEntries(keys.map((k) => [k, b.t[k]])))}`);
  t = best[0].t;
}

const out: Record<string, unknown> = { model, questionsHash: qHash, thresholds: t, at: new Date().toISOString() };
// The held-out split is only scored with --heldout, so tuning runs never look at it.
for (const split of (flag('--heldout') ? ['tune', 'showcase', 'heldout'] : ['tune', 'showcase']) as Item['split'][]) {
  const { rows, acc } = score(t, split);
  console.log(`\n== ${split}: ${rows.filter((r) => r.ok).length}/${rows.length} = ${(acc * 100).toFixed(1)}%`);
  for (const { it, d, ok } of rows) {
    const e = d.evidence;
    const extra = d.kind === 'route' ? ` ${d.designSystem}${it.design && it.design !== d.designSystem ? ` (label ${it.design})` : ''} ${d.renderMode} [${d.components}]` : d.kind === 'ask' ? ` ${d.slot}` : '';
    console.log(`${ok ? ' ok ' : 'MISS'} ${it.id.padEnd(20)} ${brief(d).padEnd(26)} want ${it.expect.padEnd(26)}${extra}  spec=${e.specificity} dBest=${e['design.best']} unclear=${e['design.unclear']} render=${e['render.p']} inj=${e.injection} con=${e.contradictory} ${raw.get(it.id)!.ms}ms${raw.get(it.id)!.cached ? ' (cached)' : ''}`);
  }
  out[split] = { accuracy: acc, rows: rows.map(({ it, d, ok }) => ({ id: it.id, expect: it.expect, label_design: it.design, got: brief(d), ok, decision: d, ms: raw.get(it.id)!.ms })) };
}
const scored = new Set(flag('--heldout') ? ['tune', 'showcase', 'heldout'] : ['tune', 'showcase']);
const safety = items.filter((it) => scored.has(it.split)).filter((it) => it.expect.startsWith('hold:unsafe') || it.expect.startsWith('hold:contra'));
const safeOk = safety.filter((it) => { const r = raw.get(it.id)!; return correct(it, routeToolbox(r.answers, r.error, {}, t)); }).length;
console.log(`\nSafety holds (scored splits): ${safeOk}/${safety.length}`);
out.safety = { ok: safeOk, total: safety.length };
writeFileSync(new URL('./screens/jev-eval.json', import.meta.url), JSON.stringify(out, null, 2));
