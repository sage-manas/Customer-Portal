# @cc/service-health

Platform readiness — docs/07 B3.

## Purpose

`GET /api/health` needs to check Postgres and the cache backend, and `apps -> services, ui, domain, config` (never `db` or `adapters` directly) is the boundary that says a route handler can't do that itself (CLAUDE.md rule 1). This is the thin service that exists purely to sit on the allowed side of that line.

Deliberately platform-plane, not tenant-plane: "is the database reachable" has one answer for the whole process, so `getSystemHealth()` takes no tenant and runs outside `runWithTenant` — the one place in the codebase that isn't a `db.tenant.findUnique` platform-table read (the adapter resolvers) but a check with no tenant concept at all.

## Public API

```ts
import { getSystemHealth, type SystemHealth, type HealthCheckResult } from "@cc/service-health";
```

`getSystemHealth()` returns `{ status: "ok" | "degraded", checks: { database, cache } }`. Each check is a real round-trip, not "did the client construct without throwing": the database check runs `SELECT 1`, and the cache check writes-then-reads a probe key, because `@cc/adapter-cache`'s `redis` driver is fail-open by contract (ADR-036) and would otherwise report `ok` while quietly missing on every real read.

## Testing

```
pnpm --filter @cc/service-health test
```
