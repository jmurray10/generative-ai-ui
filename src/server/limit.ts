/** Tiny in-memory sliding window. Enough to keep an open demo from burning a key. */

export interface Limiter {
  allow(key: string): boolean;
}

export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, number[]>();
  const cap = Math.max(1, limit);
  const window = Math.max(1, windowMs);
  return {
    allow(key: string): boolean {
      const t = now();
      const prev = (hits.get(key) ?? []).filter((stamp) => t - stamp < window);
      if (prev.length >= cap) {
        hits.set(key, prev);
        return false;
      }
      prev.push(t);
      hits.set(key, prev);
      return true;
    },
  };
}
