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

import { getGenerator } from './generator.ts';
import { examples } from './examples.ts';
import { openapiSpec } from './openapi.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CLIENT_DIST = join(PROJECT_ROOT, 'dist', 'client');

const PORT = parseInt(process.env.PORT || '8080', 10);
const generator = getGenerator();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- API -----------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', generator: generator.name, uptime: process.uptime() });
});

app.get('/api/examples', (_req: Request, res: Response) => {
  res.json(examples);
});

app.post('/api/generate', async (req: Request, res: Response) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'A non-empty "prompt" string is required.' });
    return;
  }
  try {
    const spec = await generator.generate(prompt);
    res.json({ prompt, source: generator.name, spec });
  } catch (err) {
    console.error('[generate] failed:', err);
    res.status(500).json({ error: (err as Error).message });
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
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const baseSpec = req.body?.spec;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (!prompt) {
      send('error', { error: 'A non-empty "prompt" string is required.' });
      return res.end();
    }
    const spec = baseSpec ? await generator.refine(prompt, baseSpec) : await generator.generate(prompt);
    send('meta', { title: spec.title ?? null, initialState: spec.initialState ?? {}, count: spec.tree.length, source: generator.name });
    for (let i = 0; i < spec.tree.length; i++) {
      await delay(STREAM_STAGGER_MS);
      send('node', { index: i, node: spec.tree[i] });
    }
    send('done', { spec });
  } catch (err) {
    console.error('[stream] failed:', err);
    send('error', { error: (err as Error).message });
  } finally {
    res.end();
  }
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

app.listen(PORT, () => {
  console.log(`\n  GenUI Playground`);
  console.log(`  ────────────────`);
  console.log(`  API      http://localhost:${PORT}/api/health`);
  console.log(`  Docs     http://localhost:${PORT}/docs`);
  console.log(`  Generator: ${generator.name}\n`);
});
