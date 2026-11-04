/**
 * Who may open /voice, and how much. Each voice session opens a paid realtime
 * session on the owner's xAI key, and WebSockets are not covered by CORS, so
 * the server checks the Origin itself and caps sessions per client.
 *
 *   - Browsers must come from this site (same hostname as the request) or an
 *     origin listed in CORS_ORIGIN. A page on another site can't open the socket.
 *   - Non-browser clients (no Origin header, e.g. the test scripts) are allowed,
 *     but are held to the same per-IP limits.
 *   - Per client IP: at most VOICE_MAX_SESSIONS concurrent sessions (default 2)
 *     and VOICE_OPENS_PER_MIN new sessions per minute (default 10).
 */
import type { IncomingMessage } from 'node:http';
import { createLimiter } from './limit.ts';
import { logger } from './log.ts';

const log = logger('voice');

/** Max size of one browser → server message (audio chunks are a few KB; init carries the spec). */
export const VOICE_MAX_PAYLOAD = 1024 * 1024;
/** Max characters of a typed message forwarded into the realtime session. */
export const VOICE_MAX_TEXT = 4000;

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i];

function bare(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

export function isPrivateAddress(ip: string): boolean {
  const a = bare(ip);
  return PRIVATE.some((re) => re.test(a));
}

/**
 * The client IP, matching Express's `trust proxy` default here ('loopback, uniquelocal'):
 * walk X-Forwarded-For from the right, skipping private hops (our own proxies), and take
 * the first public address. A client can prepend fake entries but can't get past nginx's
 * appended real address.
 */
export function clientIpOf(remote: string | undefined, forwardedFor: string | string[] | undefined, trustProxy = process.env.TRUST_PROXY): string {
  const socketIp = bare(remote || 'unknown');
  if (trustProxy === 'false' || trustProxy === '0' || !isPrivateAddress(socketIp)) return socketIp;
  const chain = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor || '')
    .split(',')
    .map(bare)
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isPrivateAddress(chain[i])) return chain[i];
  }
  return chain[0] || socketIp;
}

function hostnameOf(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Same site (hostname match, any port) or explicitly allowed. Missing Origin = not a browser. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowList = process.env.CORS_ORIGIN): boolean {
  if (!origin) return true;
  const allowed = (allowList || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  const o = hostnameOf(origin);
  return Boolean(o) && o === hostnameOf(host || '');
}

const intEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function createVoiceGuard() {
  const maxSessions = intEnv('VOICE_MAX_SESSIONS', 2);
  const opens = createLimiter(intEnv('VOICE_OPENS_PER_MIN', 10), 60_000);
  const builds = createLimiter(intEnv('RATE_LIMIT_PER_MIN', 30), 60_000);
  const live = new Map<string, number>();

  return {
    /** For `new WebSocketServer({ verifyClient })`. */
    verifyClient(info: { origin: string; req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void): void {
      const ip = clientIpOf(info.req.socket.remoteAddress, info.req.headers['x-forwarded-for']);
      if (!originAllowed(info.origin || undefined, info.req.headers.host)) {
        log.warn('rejected: origin', { ip, origin: info.origin });
        return done(false, 403, 'Forbidden');
      }
      if ((live.get(ip) ?? 0) >= maxSessions) {
        log.warn('rejected: too many sessions', { ip, live: live.get(ip) });
        return done(false, 429, 'Too many voice sessions');
      }
      if (!opens.allow(ip)) {
        log.warn('rejected: opening too fast', { ip });
        return done(false, 429, 'Too many voice sessions');
      }
      done(true);
    },
    /** Track a session for its lifetime; returns the client IP and a release function. */
    track(req: IncomingMessage): { ip: string; release: () => void } {
      const ip = clientIpOf(req.socket.remoteAddress, req.headers['x-forwarded-for']);
      live.set(ip, (live.get(ip) ?? 0) + 1);
      let released = false;
      return {
        ip,
        release: () => {
          if (released) return;
          released = true;
          const n = (live.get(ip) ?? 1) - 1;
          if (n <= 0) live.delete(ip);
          else live.set(ip, n);
        },
      };
    },
    /** Server-side builds from voice share the HTTP generation limit. */
    allowBuild: (ip: string) => builds.allow(ip),
  };
}
