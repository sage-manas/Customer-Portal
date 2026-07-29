import type { CacheDriverName, CacheEntry, CacheStore } from "../contract";

/**
 * The driver built first (CLAUDE.md rule 2). A `Map` with expiry — no
 * Redis, no network, no container.
 *
 * It is not only a test double. A single-instance deployment, a developer
 * with `docker compose` down, and every unit test in the repo all run
 * against this, and the only behavioural difference from Redis is that the
 * entries are not shared between processes — which for a cache of derived
 * SAP reads costs a duplicate read per process, nothing more.
 */

export interface MemoryCacheOptions {
  /** Injectable for tests, so TTL behaviour is asserted without sleeping. */
  now?: () => number;
  /** Bounds an unbounded process: oldest-written entries are dropped first. */
  maxEntries?: number;
}

interface Slot {
  value: unknown;
  storedAt: string;
  expiresAtMs: number;
}

const DEFAULT_MAX_ENTRIES = 5_000;

export class MemoryCacheStore implements CacheStore {
  readonly driver: CacheDriverName = "memory";

  private readonly slots = new Map<string, Slot>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get<T>(key: string): Promise<CacheEntry<T> | null> {
    const slot = this.slots.get(key);
    if (!slot) return Promise.resolve(null);
    if (slot.expiresAtMs <= this.now()) {
      this.slots.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve({ value: slot.value as T, storedAt: slot.storedAt });
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return Promise.resolve();

    // Re-inserting moves the key to the end of Map iteration order, which is
    // what makes the eviction below oldest-write-first.
    this.slots.delete(key);
    this.slots.set(key, {
      value,
      storedAt: new Date(this.now()).toISOString(),
      expiresAtMs: this.now() + ttlSeconds * 1000,
    });

    while (this.slots.size > this.maxEntries) {
      const oldest = this.slots.keys().next();
      if (oldest.done) break;
      this.slots.delete(oldest.value);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.slots.delete(key);
    return Promise.resolve();
  }

  deleteByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.slots.keys()]) {
      if (key.startsWith(prefix)) {
        this.slots.delete(key);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  /** Test/ops affordance; not part of the contract. */
  clear(): void {
    this.slots.clear();
  }
}
