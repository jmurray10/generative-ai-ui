/**
 * GenUI Playground server.
 *
 * Single Express process that:
 *   - exposes the generation + gallery API under /api
 *   - serves Swagger UI at /docs (spec at /openapi.json)
 *   - serves the built client (dist/client) with SPA fallback in production
 *
 * Runs via tsx (no compile step needed); in dev, Vite proxies /api and /docs here.
 */
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getGenerator, isDegradedSpec } from './generator.ts';
import { examples } from './examples.ts';
import { openapiSpec } from './openapi.ts';
import { attachVoice, voiceInfo } from './voice.ts';
import { createLimiter } from './limit.ts';
import { isMultiScreenPrompt } from './screen-route.ts';
import { specNotices, validateSpec } from './validate.ts';
import type { UISpec } from '../shared/spec.ts';
import { decideToolbox } from './toolbox.ts';
import { deciderChoice } from './config.ts';
import { confirmActs, runChat } from './chat.ts';
import { isRenderMode, type GenerateOptions } from './route-hints.ts';
import type { GenerateHooks } from './types.ts';
import { isDesignSystem, type ToolboxComponent } from '../shared/toolbox.ts';
import type { ChatRequest, UIActResult, UIControl } from '../shared/control.ts';
import type { BuildProgress } from './spec-progress.ts';
import { logger, preview, rid, since } from './log.ts';

const log = logger('http');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CLIENT_DIST = join(PROJECT_ROOT, 'dist', 'client');

const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_PROMPT = Number(process.env.MAX_PROMPT_CHARS || 4000);
const limiter = createLimiter(Number(process.env.RATE_LIMIT_PER_MIN || 30), 60_000);
const generator = getGenerator();
const voice = voiceInfo();

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function readPrompt(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const prompt = (body as { prompt?: unknown }).prompt;
  return typeof prompt === 'string' ? prompt.trim() : '';
}

// Route obviously multi-screen requests through the plan→expand path; otherwise
// honor the Jev routing decision (lane, needed pieces, style hint) when one is sent.
const generateFor = (prompt: string, opts?: GenerateOptions, hooks?: GenerateHooks) =>
  isMultiScreenPrompt(prompt) ? generator.generateApp(prompt, hooks) : generator.generate(prompt, opts, hooks);

/**
 * A spec sent back for a refine or a chat turn goes into the model prompt, so its
 * size is the request's cost. Cap it (a large generated app is well under this) and
 * normalize it before use. Returns null when absent, 'too_large' when over the cap.
 */
const MAX_SPEC_CHARS = Number(process.env.MAX_SPEC_CHARS || 200_000);
function readSpec(raw: unknown): UISpec | null | 'too_large' {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tree?: unknown }).tree)) return null;
  if (JSON.stringify(raw).length > MAX_SPEC_CHARS) return 'too_large';
  return validateSpec(raw).spec;
}

const COMPONENTS: ReadonlySet<string> = new Set(['stepper', 'table', 'drawer', 'citation_viewer', 'approval_card']);

/** Optional routing from a Jev decision in a request body. Unknown values are dropped. */
function readOptions(body: unknown): GenerateOptions | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { lane, components, style } = body as { lane?: unknown; components?: unknown; style?: unknown };
  const opts: GenerateOptions = {};
  if (isRenderMode(lane)) opts.lane = lane;
  if (Array.isArray(components)) {
    const picked = components.filter((c): c is ToolboxComponent => typeof c === 'string' && COMPONENTS.has(c));
    if (picked.length) opts.components = picked;
  }
  if (isDesignSystem(style)) opts.style = style;
  return opts.lane || opts.components || opts.style ? opts : undefined;
}

const app = express();
// Behind the web container (nginx) or a platform proxy, use the forwarded client IP so
// rate limits stay per user. Only private-network proxies are trusted by default.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean);
// Same-origin by default (the web container proxies the API onto the page's origin).
// Cross-origin browser access is opt-in with CORS_ORIGIN, so other sites can't make
// their visitors' browsers spend this deployment's model credits.
if (corsOrigin && corsOrigin.length > 0) app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// One line per API request (static assets and health checks only at LOG_LEVEL=debug).
// The id also tags the model-call and decision lines for the same request.
app.use((req, res, next) => {
  const id = rid();
  res.locals.rid = id;
  const t0 = Date.now();
  res.on('finish', () => {
    const api = req.path.startsWith('/api') && req.path !== '/api/health';
    (api ? log.info : log.debug)('request', { rid: id, method: req.method, path: req.path, status: res.statusCode, ms: since(t0), ip: clientIp(req) });
  });
  next();
});

// ---- API -----------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    generator: generator.name,
    model: generator.model,
    voice: voice.provider,
    voiceModel: voice.model,
    decider: deciderChoice(),
    uptime: process.uptime(),
  });
});

app.get('/api/examples', (_req: Request, res: Response) => {
  res.json(examples);
});

app.post('/api/generate', async (req: Request, res: Response) => {
  if (!limiter.allow(clientIp(req))) {
    res.status(429).json({ error: 'Too many generations. Wait a minute and try again.' });
    return;
  }
  const prompt = readPrompt(req.body);
  if (!prompt) {
    res.status(400).json({ error: 'A non-empty "prompt" string is required.' });
    return;
  }
  if (prompt.length > MAX_PROMPT) {
    res.status(400).json({ error: `Prompt must be ${MAX_PROMPT} characters or fewer.` });
    return;
  }
  try {
    const spec = await generateFor(prompt, readOptions(req.body), { rid: res.locals.rid });
    res.json({ prompt, source: generator.name, degraded: isDegradedSpec(spec), spec });
  } catch (err) {
    log.error('generate failed', { rid: res.locals.rid, err: (err as Error).message });
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

const STREAM_STAGGER_MS = parseInt(process.env.STREAM_STAGGER_MS || '110', 10);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Streaming build-in (SSE). Generates (or refines, if `spec` is provided) the
 * full spec, then emits it node-by-node so the client can render it
 * progressively — the "watch it build itself" moment.
 */
app.post('/api/stream', async (req: Request, res: Response) => {
  if (!limiter.allow(clientIp(req))) {
    res.status(429).json({ error: 'Too many generations. Wait a minute and try again.' });
    return;
  }
  const prompt = readPrompt(req.body);
  const baseSpec = readSpec(req.body?.spec);
  if (prompt.length > MAX_PROMPT) {
    res.status(400).json({ error: `Prompt must be ${MAX_PROMPT} characters or fewer.` });
    return;
  }
  if (baseSpec === 'too_large') {
    res.status(413).json({ error: 'That spec is too large to refine.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();
  res.write(': open\n\n'); // heartbeat so proxies don't cut the idle connection before meta

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const id = res.locals.rid as string;
  const t0 = Date.now();
  let closed = false;
  res.on('close', () => { closed = true; });

  // Live progress while the model writes the spec. Every event carries the elapsed
  // time; a 1 s tick keeps the timer honest while the model is still thinking.
  let last: BuildProgress = { phase: 'thinking', chars: 0, parts: 0 };
  const progress = (p: BuildProgress) => {
    if (p.design) log.info('design brief', { rid: id, direction: p.design.direction, ms: since(t0) });
    if (p.part) log.debug('part', { rid: id, n: p.parts, type: p.part.type, label: p.part.label });
    last = { ...last, ...p };
    send('progress', { ...p, ms: since(t0) });
  };
  const tick = setInterval(() => send('progress', { phase: last.phase, chars: last.chars, parts: last.parts, ms: since(t0) }), 1000);

  try {
    if (!prompt) {
      send('error', { error: 'A non-empty "prompt" string is required.' });
      return res.end();
    }
    const opts = readOptions(req.body);
    log.info(baseSpec ? 'refine start' : 'build start', { rid: id, lane: opts?.lane, parts: opts?.components?.join(','), style: opts?.style, prompt: preview(prompt) });
    const hooks: GenerateHooks = { rid: id, onProgress: progress };
    const spec = baseSpec ? await generator.refine(prompt, baseSpec, hooks) : await generateFor(prompt, opts, hooks);
    clearInterval(tick);
    if (closed) {
      log.info('client left before the build finished', { rid: id, ms: since(t0) });
      return;
    }
    log.info(baseSpec ? 'refine done' : 'build done', {
      rid: id,
      ms: since(t0),
      title: spec.title,
      parts: spec.tree.length,
      lanes: [...new Set(spec.tree.map((n) => n.type))].join(','),
      degraded: isDegradedSpec(spec) || undefined,
    });
    send('meta', {
      title: spec.title ?? null,
      design: spec.design ?? null,
      initialState: spec.initialState ?? {},
      count: spec.tree.length,
      source: generator.name,
      degraded: isDegradedSpec(spec),
      notices: specNotices(spec),
    });
    for (let i = 0; i < spec.tree.length; i++) {
      await delay(STREAM_STAGGER_MS);
      send('node', { index: i, node: spec.tree[i] });
    }
    send('done', { spec });
  } catch (err) {
    log.error('build failed', { rid: id, ms: since(t0), err: (err as Error).message });
    send('error', { error: 'Generation failed. Please try again.' });
  } finally {
    clearInterval(tick);
    res.end();
  }
});

/**
 * Jev toolbox decision: route (lane, pieces, style), ask one question, or hold.
 * Uses TypeSafe Jev when TYPESAFE_API_KEY is set, else a Grok judge answering the
 * same typed questions. The policy and thresholds are code (src/server/jev).
 */
app.post('/api/decide', async (req: Request, res: Response) => {
  if (!limiter.allow(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    return;
  }
  const prompt = readPrompt(req.body);
  if (!prompt || prompt.length > MAX_PROMPT) {
    res.status(400).json({ error: `A non-empty "prompt" of at most ${MAX_PROMPT} characters is required.` });
    return;
  }
  const t0 = Date.now();
  const env = await decideToolbox(prompt, undefined, { answered: req.body?.answered === true });
  const d = env.decision as { kind: string; renderMode?: string; components?: string[]; designSystem?: string; reason?: string };
  log.info('decision', {
    rid: res.locals.rid,
    decider: deciderChoice(),
    kind: d.kind,
    lane: d.renderMode,
    parts: d.components?.join(','),
    style: d.designSystem,
    reason: d.reason,
    ms: since(t0),
    prompt: preview(prompt),
  });
  res.json(env);
});

/**
 * Chat with the live UI: answer from the screen, operate it (acts run in the
 * browser), or rebuild it. Same tools the voice agent has.
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  if (!limiter.allow(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    return;
  }
  const body = (req.body ?? {}) as Partial<ChatRequest>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MAX_PROMPT) {
    res.status(400).json({ error: `A non-empty "message" of at most ${MAX_PROMPT} characters is required.` });
    return;
  }
  const chatSpec = readSpec(body.spec);
  if (chatSpec === 'too_large') {
    res.status(413).json({ error: 'The interface is too large to send with a message.' });
    return;
  }
  const controls = Array.isArray(body.controls) ? (body.controls as UIControl[]).filter((c) => c && typeof c.id === 'string').slice(0, 80) : [];
  const history = Array.isArray(body.history) ? body.history.filter((t) => t && typeof t.text === 'string').slice(-8) : [];
  const t0 = Date.now();
  try {
    const out = await runChat({
      message,
      spec: chatSpec,
      readable: typeof body.readable === 'string' ? body.readable.slice(0, 8000) : '',
      controls,
      history,
    }, generator);
    log.info('chat', {
      rid: res.locals.rid,
      change: out.change,
      acts: out.acts.map((a) => a.action).join(',') || undefined,
      rebuilt: Boolean(out.spec) || undefined,
      ok: out.ok,
      controls: controls.length,
      ms: since(t0),
      message: preview(message),
    });
    res.json(out);
  } catch (err) {
    log.error('chat failed', { rid: res.locals.rid, ms: since(t0), err: (err as Error).message });
    res.status(502).json({ error: 'The model did not answer. Please try again.' });
  }
});

/**
 * After the browser runs a chat turn's acts, restate what actually happened from
 * the real results and the refreshed screen (the first reply was written before
 * the acts ran). Uses a fast model.
 */
app.post('/api/chat/confirm', async (req: Request, res: Response) => {
  if (!limiter.allow(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    return;
  }
  const body = (req.body ?? {}) as { message?: unknown; results?: unknown; readable?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_PROMPT) : '';
  const results = Array.isArray(body.results)
    ? (body.results as UIActResult[]).filter((r) => r && typeof r.action === 'string').slice(0, 12)
        .map((r) => ({ action: r.action.slice(0, 100), ok: r.ok === true, ...(r.detail != null ? { detail: String(r.detail).slice(0, 300) } : {}) }))
    : [];
  if (!message || !results.length) {
    res.status(400).json({ error: '"message" and a non-empty "results" array are required.' });
    return;
  }
  if (generator.name !== 'grok') {
    res.json({ reply: results.every((r) => r.ok) ? 'Done.' : 'Some steps did not apply.', ok: results.every((r) => r.ok) });
    return;
  }
  const t0 = Date.now();
  const out = await confirmActs({ message, results, readable: typeof body.readable === 'string' ? body.readable.slice(0, 8000) : '' });
  log.info('chat confirm', {
    rid: res.locals.rid,
    results: results.map((r) => `${r.action}:${r.ok ? 'ok' : 'fail'}`).join(','),
    ok: out.ok,
    ms: since(t0),
  });
  res.json(out);
});

// Malformed JSON bodies get a JSON 400, not an HTML error page and a stack trace.
app.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }
  next(err);
});

// ---- Docs ----------------------------------------------------------------
app.get('/openapi.json', (_req: Request, res: Response) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'GenUI Playground API' }));

// ---- Static client (production) ------------------------------------------
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/docs') || req.path === '/openapi.json') {
      return next();
    }
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
} else {
  // API-only image (the web container serves the client), or dev with Vite on :5173.
  logger('server').info('no client bundle here; serving the API only');
}

const server = app.listen(PORT, () => {
  logger('server').info('listening', {
    url: `http://localhost:${PORT}`,
    generator: generator.name,
    model: generator.model,
    voice: voice.provider,
    voiceModel: voice.model,
    decider: deciderChoice(),
    judgeModel: deciderChoice() === 'grok' ? process.env.JEV_JUDGE_MODEL || undefined : undefined,
    confirmModel: process.env.CHAT_CONFIRM_MODEL || process.env.JEV_JUDGE_MODEL || undefined,
    logLevel: process.env.LOG_LEVEL || 'info',
    node: process.version,
  });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    logger('server').info('shutting down', { signal: sig, uptimeS: Math.round(process.uptime()) });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
process.on('unhandledRejection', (err) => logger('server').error('unhandled rejection', { err: (err as Error)?.message ?? String(err) }));

// Gemini Live voice agent (WebSocket /voice) — no-op if no key.
attachVoice(server);
