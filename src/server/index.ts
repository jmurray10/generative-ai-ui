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
import { specNotices } from './validate.ts';
import { decideToolbox } from './toolbox.ts';
import { deciderChoice } from './config.ts';
import { runChat } from './chat.ts';
import { isRenderMode, type GenerateOptions } from './route-hints.ts';
import { isDesignSystem, type ToolboxComponent } from '../shared/toolbox.ts';
import type { ChatRequest, UIControl } from '../shared/control.ts';

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
const generateFor = (prompt: string, opts?: GenerateOptions) =>
  isMultiScreenPrompt(prompt) ? generator.generateApp(prompt) : generator.generate(prompt, opts);

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
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(corsOrigin && corsOrigin.length > 0 ? cors({ origin: corsOrigin }) : cors());
app.use(express.json({ limit: '1mb' }));

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
    const spec = await generateFor(prompt, readOptions(req.body));
    res.json({ prompt, source: generator.name, degraded: isDegradedSpec(spec), spec });
  } catch (err) {
    console.error('[generate] failed:', err);
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
  const baseSpec = req.body?.spec;
  if (prompt.length > MAX_PROMPT) {
    res.status(400).json({ error: `Prompt must be ${MAX_PROMPT} characters or fewer.` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();
  res.write(': open\n\n'); // heartbeat so proxies don't cut the idle connection before meta

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (!prompt) {
      send('error', { error: 'A non-empty "prompt" string is required.' });
      return res.end();
    }
    const spec = baseSpec ? await generator.refine(prompt, baseSpec) : await generateFor(prompt, readOptions(req.body));
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
    console.error('[stream] failed:', err);
    send('error', { error: 'Generation failed. Please try again.' });
  } finally {
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
  res.json(await decideToolbox(prompt, undefined, { answered: req.body?.answered === true }));
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
  const controls = Array.isArray(body.controls) ? (body.controls as UIControl[]).filter((c) => c && typeof c.id === 'string').slice(0, 80) : [];
  const history = Array.isArray(body.history) ? body.history.filter((t) => t && typeof t.text === 'string').slice(-8) : [];
  try {
    const out = await runChat({
      message,
      spec: body.spec && Array.isArray((body.spec as { tree?: unknown }).tree) ? body.spec : null,
      readable: typeof body.readable === 'string' ? body.readable.slice(0, 8000) : '',
      controls,
      history,
    }, generator);
    res.json(out);
  } catch (err) {
    console.error('[chat] failed:', (err as Error).message);
    res.status(502).json({ error: 'The model did not answer. Please try again.' });
  }
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
  console.log('[server] dist/client not built yet — run `npm run build` (dev uses Vite on :5173).');
}

const server = app.listen(PORT, () => {
  console.log(`\n  GenUI Playground`);
  console.log(`  ────────────────`);
  console.log(`  API      http://localhost:${PORT}/api/health`);
  console.log(`  Docs     http://localhost:${PORT}/docs`);
  console.log(`  Generator: ${generator.name}\n`);
});

// Gemini Live voice agent (WebSocket /voice) — no-op if no key.
attachVoice(server);
