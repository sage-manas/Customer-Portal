/**
 * Portal read cache — the cache-aside layer docs/02 §4.3 specifies
 * ("cache-aside with per-entity TTLs") and the one ADR-016 and ADR-033 both
 * name as the acceptable answer to "three SAP reads per page load".
 *
 * Redis is an external system, so it sits behind an interface with a
 * non-Redis driver built first, like SAP, GSTN, storage and the payment
 * gateway (CLAUDE.md rule 2). Service code holds this contract and a key;
 * it never knows whether the bytes are in a `Map` or in Redis, and a tenant
 * running without Redis configured is a driver choice rather than a code
 * path.
 *
 * **A cache never fails a request.** Every method here is fail-open: a
 * backend that is down, slow or returning nonsense produces a miss, not an
 * exception. That is the whole point of the layer — a portal that 500s
 * because its *cache* is unreachable is strictly worse than one with no
 * cache at all. Failures are reported through `onError` (config) so B3's
 * observability work has something to attach to, never by throwing.
 */

export type CacheDriverName = "memory" | "redis";

export interface CacheEntry<T> {
  value: T;
  /**
   * When this entry was written, ISO. Callers surface it rather than the
   * moment of the read: a cached answer that claims to be current is the
   * mirror ADR-016 exists to prevent, and `SapSyncIndicator` needs a real
   * timestamp to render "as of".
   */
  storedAt: string;
}

export interface CacheStore {
  readonly driver: CacheDriverName;
  /** Returns null on a miss, an expired entry, or any backend failure. */
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  /** Fire-and-forget by contract: a failed write is a future miss. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Invalidates every key under a prefix. Built for tenant-wide eviction
   * (`cacheKeyPrefix(tenantId)`) — the caller that changes a tenant's
   * settings drops that tenant's derived reads and nobody else's.
   */
  deleteByPrefix(prefix: string): Promise<number>;
}
