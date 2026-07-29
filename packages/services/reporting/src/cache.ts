import { cacheKey, cacheKeyPrefix, createCacheStore, type CacheStore } from "@cc/adapter-cache";
import type { FreshnessClass } from "@cc/adapter-sap";
import { REPORT_CACHE_VERSION, type ReportCacheNamespace } from "@cc/domain";

/**
 * The cache-aside wrapper every report goes through.
 *
 * Two things it guarantees, and both are the reason ADR-036 made the cache
 * an adapter rather than an `ioredis` import in a service:
 *
 * 1. **A cache hit is labelled `cached`, never `live`.** The stored payload
 *    carries the `syncedAt` SAP gave when the data was actually read, and
 *    that is what comes back out — so `SapSyncIndicator` prints the real
 *    "as of" and the screen tells the truth (docs/05 P1). A cache that
 *    reported `live` would be the silent mirror ADR-016 exists to prevent.
 * 2. **A cache never fails a request.** The store's contract is fail-open,
 *    so a miss and an outage are the same code path: compute it.
 *
 * A read that came back from SAP already degraded (`stale`) is **not**
 * written to the cache. Caching a degraded answer would extend one SAP
 * outage into fifteen minutes of everybody being told the same wrong thing,
 * long after SAP came back.
 */

export interface Cached<T> {
  data: T;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** The cache is a platform choice, like object storage — one per process. */
export function getReportCache(): CacheStore {
  const url = process.env.REDIS_URL;
  const driver = process.env.REPORT_CACHE_DRIVER ?? (url ? "redis" : "memory");
  if (driver === "redis" && url) {
    return createCacheStore({ driver: "redis", url });
  }
  return createCacheStore({ driver: "memory" });
}

export interface CacheAsideOptions<T> {
  store: CacheStore;
  tenantId: string;
  namespace: ReportCacheNamespace;
  parts: readonly (string | number)[];
  ttlSeconds: number;
  /** Skips the read and refreshes the entry — the "Refresh" button. */
  bypass?: boolean;
  load: () => Promise<Cached<T>>;
}

export async function cacheAside<T>({
  store,
  tenantId,
  namespace,
  parts,
  ttlSeconds,
  bypass = false,
  load,
}: CacheAsideOptions<T>): Promise<Cached<T>> {
  const key = cacheKey({ tenantId, namespace, parts, version: REPORT_CACHE_VERSION });

  if (!bypass) {
    const hit = await store.get<Cached<T>>(key);
    if (hit) {
      return {
        data: hit.value.data,
        // Even an entry written from a `live` read is `cached` on the way
        // out: freshness describes *this* answer, not the one that filled it.
        freshness: "cached",
        syncedAt: hit.value.syncedAt,
      };
    }
  }

  const computed = await load();
  if (computed.freshness !== "stale") {
    await store.set(key, computed, ttlSeconds);
  }
  return computed;
}

/** Drops one tenant's reports — what a settings change invalidates. */
export function invalidateTenantReports(store: CacheStore, tenantId: string): Promise<number> {
  return store.deleteByPrefix(cacheKeyPrefix(tenantId, REPORT_CACHE_VERSION));
}
