/**
 * Sliding-window rate limiter. In-memory per instance — sufficient for a
 * single-node deployment and for shaping abusive bursts; swap the store for
 * Redis when running multiple instances (the interface stays the same).
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterS: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { allowed: false, retryAfterS: Math.ceil((hits[0] + windowMs - now) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => t <= windowStart)) buckets.delete(k);
  }
  return { allowed: true, retryAfterS: 0 };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
}
