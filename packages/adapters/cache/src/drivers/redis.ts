import Redis, { type RedisOptions } from "ioredis";

import type { CacheDriverName, CacheEntry, CacheStore } from "../contract";

/**
 * Redis driver — the same instance docker-compose.dev.yml already runs for
 * BullMQ, and the one docs/02 §4.3 assumes for cache-aside.
 *
 * Two behaviours worth reading before changing anything here:
 *
 * 1. **Every method is fail-open.** A `get` that throws is a miss, a `set`
 *    that throws is a future miss, and neither reaches the caller. The
 *    contract promises this; a report page must not 500 because Redis
 *    restarted. `onError` is how those failures leave the building.
 * 2. **`deleteByPrefix` uses SCAN, never KEYS.** `KEYS` blocks the whole
 *    server for the length of the keyspace, which on a shared instance
 *    means one tenant's settings save stalls every other tenant's queue.
 */

export interface RedisCacheConfig {
  url: string;
  /** Reported rather than thrown — see the class comment. */
  onError?: (error: unknown, operation: string) => void;
  /** Injected in tests; production builds one from `url`. */
  client?: Redis;
  options?: RedisOptions;
}

const SCAN_COUNT = 200;

export class RedisCacheStore implements CacheStore {
  readonly driver: CacheDriverName = "redis";

  private readonly client: Redis;
  private readonly onError: (error: unknown, operation: string) => void;

  constructor(config: RedisCacheConfig) {
    this.client =
      config.client ??
      new Redis(config.url, {
        // A cache is optional by definition, so a command issued while the
        // connection is down should fail fast into a miss rather than queue
        // up behind a reconnect and hold the request open.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        ...config.options,
      });
    this.onError = config.onError ?? (() => undefined);

    // ioredis emits `error` on an unreachable server; an unhandled 'error'
    // event on an EventEmitter crashes the process.
    this.client.on("error", (error: unknown) => {
      this.onError(error, "connection");
    });
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      // A payload written by an older shape, or by something else entirely,
      // is a miss rather than an object with missing fields (see the
      // `version` segment in keys.ts, which is the deliberate half of this).
      if (typeof parsed !== "object" || parsed === null || !("value" in parsed)) return null;
      return parsed;
    } catch (error) {
      this.onError(error, "get");
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      const entry: CacheEntry<T> = { value, storedAt: new Date().toISOString() };
      await this.client.set(key, JSON.stringify(entry), "EX", Math.ceil(ttlSeconds));
    } catch (error) {
      this.onError(error, "set");
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.onError(error, "delete");
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let cursor = "0";
    let removed = 0;
    try {
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          SCAN_COUNT,
        );
        cursor = next;
        if (keys.length > 0) removed += await this.client.del(...keys);
      } while (cursor !== "0");
    } catch (error) {
      this.onError(error, "deleteByPrefix");
    }
    return removed;
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      this.onError(error, "disconnect");
    }
  }
}
