import { createCacheStore, resetCacheStore } from "@cc/adapter-cache";
import { db } from "@cc/db";
import { getLogger } from "@cc/observability";

const logger = getLogger("service.health");

/**
 * Platform readiness (docs/07 B3), behind `apps/web/app/api/health/route.ts`.
 *
 * Deliberately not tenant-scoped: unlike everything else in the portal, "is
 * Postgres reachable" is a platform-plane question with the same answer for
 * every tenant, so this is the one read in the codebase that legitimately
 * runs outside `runWithTenant` for a reason beyond "the model isn't tenant
 * data" (`db.tenant.findUnique` in the adapter resolvers) — there is no
 * tenant here at all.
 */
export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  checks: {
    database: HealthCheckResult;
    cache: HealthCheckResult;
  };
}

async function checkDatabase(): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    logger.error({ err: error }, "database health check failed");
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function checkCache(): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  try {
    // Whatever driver the platform actually runs (docs/DECISIONS.md
    // ADR-036) — a set/get round-trip, not just "did the constructor
    // throw", because the redis driver is fail-open by contract and would
    // otherwise report healthy while quietly missing on every read.
    const store = createCacheStore({
      driver: process.env.CACHE_DRIVER === "redis" ? "redis" : "memory",
      url: process.env.REDIS_URL,
    });
    const probeKey = `health-check::${Date.now()}`;
    await store.set(probeKey, true, 5);
    const entry = await store.get<boolean>(probeKey);
    await store.delete(probeKey);
    return { ok: entry?.value === true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    logger.error({ err: error }, "cache health check failed");
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [database, cache] = await Promise.all([checkDatabase(), checkCache()]);
  return {
    status: database.ok && cache.ok ? "ok" : "degraded",
    checks: { database, cache },
  };
}

/** Test affordance: the cache factory memoizes a store per process. */
export { resetCacheStore };
