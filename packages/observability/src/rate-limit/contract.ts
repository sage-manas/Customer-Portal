/**
 * Rate limiting, kept edge-safe (no Node built-ins, no `pino`/OTel/Sentry
 * imports) because `apps/web/middleware.ts` runs on the edge runtime and is
 * the only caller of `consume` — everything else in the portal enforces
 * limits at the reverse proxy or not at all in this phase.
 *
 * Unlike `@cc/adapter-cache`, this is not modelled as an external system
 * with a mock-first driver: there is no business behaviour that differs
 * between a `memory` and a `redis` limiter, only a scaling property (do
 * concurrent edge instances share one counter or not), so there is no mock
 * to build first in the CLAUDE.md rule 2 sense. `memory` is simply what
 * exists today; `redis` is the documented extension point for a multi-instance
 * deployment (docs/DECISIONS.md ADR-043).
 */
export type RateLimiterDriverName = "memory" | "redis";

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window, floored at 0. */
  remaining: number;
  /** When the current window resets, epoch ms. */
  resetAtMs: number;
}

export interface RateLimiter {
  readonly driver: RateLimiterDriverName;
  /** Fixed-window counter. Never throws — a limiter failure must not block a request. */
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}
