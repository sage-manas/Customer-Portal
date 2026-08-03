import type { CacheDriverName, CacheStore } from "./contract";
import { MemoryCacheStore } from "./drivers/memory";
import { RedisCacheStore } from "./drivers/redis";
import { CacheError } from "./errors";

/**
 * Cache resolution. Like storage (and unlike SAP), this is a *platform*
 * choice rather than a per-tenant one — every tenant shares the instance
 * and isolation is the key prefix (keys.ts), which is why the factory
 * caches one store per process rather than one per tenant.
 */
export interface CacheConfig {
  driver: CacheDriverName;
  /** Required for `redis`. */
  url?: string;
  onError?: (error: unknown, operation: string) => void;
}

let cached: { key: string; store: CacheStore } | undefined;

function build(config: CacheConfig): CacheStore {
  switch (config.driver) {
    case "memory":
      return new MemoryCacheStore();
    case "redis":
      if (!config.url) {
        throw new CacheError("The redis cache driver needs a connection URL.", {
          kind: "misconfigured",
        });
      }
      return new RedisCacheStore({ url: config.url, onError: config.onError });
    default: {
      const exhaustive: never = config.driver;
      throw new CacheError(`Unknown cache driver: ${String(exhaustive)}`, {
        kind: "misconfigured",
      });
    }
  }
}

export function createCacheStore(config: CacheConfig): CacheStore {
  const key = `${config.driver}::${config.url ?? ""}`;
  if (cached?.key === key) return cached.store;

  const store = build(config);
  cached = { key, store };
  return store;
}

export function resetCacheStore(): void {
  cached = undefined;
}
