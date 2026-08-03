import type { RateLimiter, RateLimiterDriverName } from "./contract";
import { MemoryRateLimiter } from "./memory";

/**
 * One limiter per process, like `@cc/adapter-cache`'s factory — rate
 * limiting is a platform concern, not a per-tenant driver choice.
 */
let instance: RateLimiter | undefined;

export function createRateLimiter(driver: RateLimiterDriverName = "memory"): RateLimiter {
  if (instance && instance.driver === driver) return instance;
  if (driver !== "memory") {
    throw new Error(
      `Rate limiter driver "${driver}" is not built yet — only "memory" exists (docs/DECISIONS.md ADR-043).`,
    );
  }
  instance = new MemoryRateLimiter();
  return instance;
}

export function resetRateLimiter(): void {
  instance = undefined;
}
