import type { RateLimitResult, RateLimiter, RateLimiterDriverName } from "./contract";

/**
 * A fixed-window counter in a `Map`. Correct within one process; across
 * several concurrent edge instances each gets its own window, so the
 * effective limit is `limit * instanceCount` rather than `limit` — an
 * accepted gap for this phase (docs/DECISIONS.md ADR-043), not a silent one.
 */
const DEFAULT_MAX_KEYS = 50_000;

interface Window {
  count: number;
  windowStartMs: number;
}

export class MemoryRateLimiter implements RateLimiter {
  readonly driver: RateLimiterDriverName = "memory";

  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(options: { now?: () => number; maxKeys?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const existing = this.windows.get(key);

    if (!existing || now - existing.windowStartMs >= windowMs) {
      this.windows.set(key, { count: 1, windowStartMs: now });
      this.evictIfNeeded();
      return Promise.resolve({ allowed: true, remaining: limit - 1, resetAtMs: now + windowMs });
    }

    const resetAtMs = existing.windowStartMs + windowMs;
    if (existing.count >= limit) {
      return Promise.resolve({ allowed: false, remaining: 0, resetAtMs });
    }

    existing.count += 1;
    return Promise.resolve({
      allowed: true,
      remaining: Math.max(0, limit - existing.count),
      resetAtMs,
    });
  }

  private evictIfNeeded(): void {
    while (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}
