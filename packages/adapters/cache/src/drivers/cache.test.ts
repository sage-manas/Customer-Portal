import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCacheError } from "../errors";
import { createCacheStore, resetCacheStore } from "../factory";
import { cacheKey, cacheKeyPrefix } from "../keys";

import { MemoryCacheStore } from "./memory";

const KEY_VERSION = 1;

describe("cacheKey", () => {
  it("namespaces every key by tenant", () => {
    expect(cacheKey({ tenantId: "t1", namespace: "reports.sales", version: KEY_VERSION })).toBe(
      "cc:v1:t1:reports.sales",
    );
  });

  it("varies the key by every part, in order", () => {
    const a = cacheKey({
      tenantId: "t1",
      namespace: "reports.sales",
      parts: ["0010001001", "last-12-months"],
      version: KEY_VERSION,
    });
    const b = cacheKey({
      tenantId: "t1",
      namespace: "reports.sales",
      parts: ["last-12-months", "0010001001"],
      version: KEY_VERSION,
    });
    expect(a).not.toBe(b);
  });

  it("cannot build an un-tenanted key", () => {
    // CLAUDE.md rule 4 in the cache: the failure mode of a caller that
    // forgets the tenant is a throw, not a shared entry.
    expect(() => cacheKey({ tenantId: "", namespace: "reports.sales", version: 1 })).toThrow();
    try {
      cacheKey({ tenantId: "   ", namespace: "reports.sales", version: 1 });
    } catch (error) {
      expect(isCacheError(error) && error.kind).toBe("invalid_key");
    }
  });

  it("refuses a segment carrying the separator, so prefixes stay unambiguous", () => {
    expect(() => cacheKey({ tenantId: "t1:t2", namespace: "reports", version: 1 })).toThrow();
  });

  it("keeps one tenant's prefix off another's keys", () => {
    const prefix = cacheKeyPrefix("t1", KEY_VERSION);
    expect(cacheKey({ tenantId: "t1", namespace: "n", version: KEY_VERSION })).toContain(prefix);
    expect(cacheKey({ tenantId: "t2", namespace: "n", version: KEY_VERSION })).not.toContain(
      prefix,
    );
  });
});

describe("MemoryCacheStore", () => {
  let clock = 1_700_000_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_700_000_000_000;
  });

  it("returns a miss for a key never written", async () => {
    const store = new MemoryCacheStore({ now });
    expect(await store.get("cc:v1:t1:x")).toBeNull();
  });

  it("round-trips a value and reports when it was stored", async () => {
    const store = new MemoryCacheStore({ now });
    await store.set("k", { total: 42 }, 60);
    const entry = await store.get<{ total: number }>("k");
    expect(entry?.value.total).toBe(42);
    expect(entry?.storedAt).toBe(new Date(clock).toISOString());
  });

  it("expires an entry once its TTL has passed", async () => {
    const store = new MemoryCacheStore({ now });
    await store.set("k", 1, 30);
    clock += 29_000;
    expect(await store.get("k")).not.toBeNull();
    clock += 2_000;
    expect(await store.get("k")).toBeNull();
  });

  it("treats a non-positive TTL as 'do not cache'", async () => {
    const store = new MemoryCacheStore({ now });
    await store.set("k", 1, 0);
    expect(await store.get("k")).toBeNull();
  });

  it("evicts oldest-written first once bounded", async () => {
    const store = new MemoryCacheStore({ now, maxEntries: 2 });
    await store.set("a", 1, 60);
    await store.set("b", 2, 60);
    await store.set("c", 3, 60);
    expect(await store.get("a")).toBeNull();
    expect(await store.get("c")).not.toBeNull();
  });

  it("deletes by prefix without touching another tenant", async () => {
    const store = new MemoryCacheStore({ now });
    await store.set(cacheKey({ tenantId: "t1", namespace: "a", version: 1 }), 1, 60);
    await store.set(cacheKey({ tenantId: "t1", namespace: "b", version: 1 }), 2, 60);
    await store.set(cacheKey({ tenantId: "t2", namespace: "a", version: 1 }), 3, 60);

    expect(await store.deleteByPrefix(cacheKeyPrefix("t1", 1))).toBe(2);
    expect(
      await store.get(cacheKey({ tenantId: "t2", namespace: "a", version: 1 })),
    ).not.toBeNull();
  });
});

describe("createCacheStore", () => {
  beforeEach(() => {
    resetCacheStore();
  });

  it("reuses one store per process for the same config", () => {
    expect(createCacheStore({ driver: "memory" })).toBe(createCacheStore({ driver: "memory" }));
  });

  it("refuses the redis driver without a URL, loudly", () => {
    expect(() => createCacheStore({ driver: "redis" })).toThrow(/connection URL/);
  });

  it("builds a redis store when configured", () => {
    const onError = vi.fn();
    const store = createCacheStore({ driver: "redis", url: "redis://localhost:6379", onError });
    expect(store.driver).toBe("redis");
  });
});
