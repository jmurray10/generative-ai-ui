/**
 * Raw TypeSafe System One call: POST {base}/v1/systemone with a Bearer key.
 * Same request and response shape as @typesafe-ai/sdk 0.7.0 (which needs Node 22+).
 */
import { typesafeBaseURL, typesafeKey } from '../config.ts';
import { JEV_MODEL, Q, REGISTRY_NAMES } from './router.questions.ts';
import type { Answers } from './policy.ts';

export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface JevResult { answers: Answers; model: string }

export async function askJev(prompt: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<JevResult> {
  const key = typesafeKey(env);
  if (!key) throw new JevError('TYPESAFE_API_KEY is not set');
  const model = env.TYPESAFE_DEFAULT_MODEL?.trim() || JEV_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(env.TYPESAFE_TIMEOUT_MS || 4000));
  try {
    const res = await fetchImpl(`${typesafeBaseURL(env)}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state: { prompt, registry: REGISTRY_NAMES }, questions: Q }),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as { answers?: Answers; model?: string; detail?: { error_type?: string; message?: string } };
    if (!res.ok) {
      const kind = body?.detail?.error_type ?? 'http_error';
      throw new JevError(`TypeSafe ${res.status} ${kind}`, res.status);
    }
    if (!body.answers) throw new JevError('TypeSafe response had no answers');
    return { answers: body.answers, model: body.model ?? model };
  } catch (err) {
    if (err instanceof JevError) throw err;
    throw new JevError((err as Error).name === 'AbortError' ? 'TypeSafe request timed out' : `TypeSafe request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
