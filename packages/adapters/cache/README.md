# @cc/adapter-cache

The cache-aside layer docs/02 §4.3 specifies, behind an interface — ADR-036.

## Purpose

Redis is an external system, so it gets the same treatment as SAP, GSTN, object storage and the payment gateway (CLAUDE.md rule 2): a contract, a non-Redis driver built first, real driver behind a factory. `@cc/service-reporting` holds a `CacheStore` and a key; it has no idea whether the entry is in a `Map` or in Redis, and a deployment without Redis is a driver choice rather than a branch in service code.

This is the layer ADR-016 and ADR-033 both promised. Both said the honest answer to "that page is three SAP reads" is a cache that **reports `cached`** and lets the screen say so — never a projection table, which reports nothing. `SapRead.freshness` already carries the vocabulary; this package is what finally produces the `cached` value legitimately.

## A cache never fails a request

Every method on `CacheStore` is fail-open. A backend that is down, slow, or returning a payload from an older deploy produces a **miss**, not an exception: the caller re-reads SAP and the page renders live. A portal that 500s because its cache is unreachable is strictly worse than one with no cache, so this is a property of the contract rather than of any one driver. Failures leave through `onError` (config) so B3's observability work has something to attach to.

The two things this package _does_ throw for are programming errors, not backend faults: a key built without a tenant, and a driver configured without the settings it needs. Both would otherwise degrade into a quiet wrong answer.

## Tenant isolation is in the key builder

`cacheKey()` is the only way to make a key, and it **cannot produce one that is not tenant-scoped** — `tenantId` is required and refused when empty or blank. That is CLAUDE.md rule 4 one layer sideways from `runWithTenant`: the failure mode of a caller who forgets the tenant is a throw at the call site, never one tenant's aggregate served to another. A segment containing `:` is refused for the same reason a prefix delete has to be unambiguous.

`version` is a required part of every key. When the _shape_ of a cached value changes, bumping it makes every old entry unreachable in one line — without it, a deploy that adds a field to a report reads yesterday's shape back out of Redis and renders `undefined` into a KPI tile.

## Public API

```ts
import {
  createCacheStore, // ({ driver, url?, onError? }) -> CacheStore, one per process
  resetCacheStore,
  cacheKey, // ({ tenantId, namespace, parts, version }) -> string
  cacheKeyPrefix, // (tenantId, version) -> everything belonging to one tenant
  MemoryCacheStore,
  RedisCacheStore,
  CacheError,
  isCacheError,
  type CacheStore,
  type CacheEntry,
} from "@cc/adapter-cache";
```

## Drivers

| Driver   | When                                                                | Notes                                                                                                                                     |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` | Default. Tests, `docker compose` down, single-instance deployments. | `Map` + expiry, bounded (oldest-write-first eviction). Not shared between processes.                                                      |
| `redis`  | The instance `docker-compose.dev.yml` already runs for BullMQ.      | `SCAN`-based prefix delete, never `KEYS` — `KEYS` blocks the server for the whole keyspace, which would stall every other tenant's queue. |

## Testing

```
pnpm --filter @cc/adapter-cache test
```

Unit only, and deliberately: the memory driver takes an injectable clock, so TTL behaviour is asserted without sleeping, and the redis driver's contract-level promise (fail-open) is a property of code that has no branch on connectivity.
