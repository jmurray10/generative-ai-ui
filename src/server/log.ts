/**
 * One-line structured logs for `docker compose logs`.
 *
 *   LOG_LEVEL  = debug | info (default) | warn | error
 *   LOG_FORMAT = pretty (default) | json
 *
 * pretty: `2026-11-04T15:03:28.120Z INFO  stream  done  rid=a1b2 ms=31840 parts=4`
 * json:   one JSON object per line, for log shippers.
 *
 * Fields are data about requests (ids, sizes, timings, model names, decisions).
 * Prompts are logged only as a short preview, and never at warn/error.
 */
import { randomBytes } from 'node:crypto';

export type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const v = (process.env.LOG_LEVEL || 'info').toLowerCase() as Level;
  return ORDER[v] ?? ORDER.info;
}

const json = () => (process.env.LOG_FORMAT || '').toLowerCase() === 'json';

function fmt(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return /[\s="]/.test(v) ? JSON.stringify(v) : v;
  if (v instanceof Error) return JSON.stringify(v.message);
  return JSON.stringify(v);
}

export function log(level: Level, scope: string, msg: string, fields: Fields = {}): void {
  if (ORDER[level] < threshold()) return;
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''));
  const line = json()
    ? JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...clean, ...(clean.err instanceof Error ? { err: clean.err.message } : {}) })
    : `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${scope.padEnd(7)} ${msg}${Object.entries(clean).map(([k, v]) => ` ${k}=${fmt(v)}`).join('')}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const logger = (scope: string) => ({
  debug: (msg: string, f?: Fields) => log('debug', scope, msg, f),
  info: (msg: string, f?: Fields) => log('info', scope, msg, f),
  warn: (msg: string, f?: Fields) => log('warn', scope, msg, f),
  error: (msg: string, f?: Fields) => log('error', scope, msg, f),
});

/** Short request id for correlating lines. */
export const rid = () => randomBytes(3).toString('hex');

/** A prompt preview safe for logs: single line, clipped. */
export const preview = (s: string, n = 80) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** Milliseconds since `t0`. */
export const since = (t0: number) => Date.now() - t0;
