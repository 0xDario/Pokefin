/**
 * In-memory token-bucket rate limiter for Next.js middleware.
 *
 * Limitation: state lives in the module scope of a single serverless
 * instance. A cold-start scale-out gets its own counters, so this
 * provides burst-protection per-instance — not the durable shared
 * limit you get with Upstash/Redis. Acceptable as a stopgap; see
 * HARDENING_FOLLOWUPS.md section 4 for the upgrade path.
 *
 * Algorithm: fixed-window. Each key tracks (windowStart, count). A
 * request consumes 1 token if count < limit; otherwise rejected with
 * the seconds-until-reset for Retry-After.
 */

type Bucket = { windowStart: number; count: number };

const store = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  // Evict opportunistically when the map gets large, to avoid an
  // unbounded memory footprint on a long-lived instance.
  if (store.size > MAX_KEYS) {
    for (const [k, b] of store) {
      if (now - b.windowStart > windowMs) store.delete(k);
      if (store.size <= MAX_KEYS / 2) break;
    }
  }

  const bucket = store.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    store.set(key, { windowStart: now, count: 1 });
    return {
      success: true,
      remaining: limit - 1,
      resetSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (bucket.count >= limit) {
    const resetSeconds = Math.ceil(
      (bucket.windowStart + windowMs - now) / 1000
    );
    return { success: false, remaining: 0, resetSeconds };
  }

  bucket.count += 1;
  return {
    success: true,
    remaining: limit - bucket.count,
    resetSeconds: Math.ceil((bucket.windowStart + windowMs - now) / 1000),
  };
}

export const RATE_LIMITS = {
  // Per-IP general limit for anything under /api/* or /auth/*
  general: { limit: 60, windowMs: 60_000 },
  // Tighter limit for destructive / abuse-prone endpoints
  sensitive: { limit: 5, windowMs: 60_000 },
} as const;

export function classifyRoute(pathname: string): keyof typeof RATE_LIMITS | null {
  if (pathname.startsWith("/api/account/")) return "sensitive";
  if (pathname.startsWith("/auth/")) return "sensitive";
  if (pathname.startsWith("/api/")) return "general";
  return null;
}

export function clientIp(req: { headers: Headers }): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "anon";
}

// Test-only escape hatch so unit tests can isolate state.
export function _resetRateLimitStoreForTests() {
  store.clear();
}
