import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request correlation, carried implicitly through async calls rather than
 * threaded as a parameter through every service and adapter method — the
 * same trade-off `runWithTenant` (`@cc/db`) makes for tenant scoping, one
 * layer up. `requestId` is set once per request (the route helpers in
 * `apps/web/lib/*-route.ts`); `tenantId`/`userId` are filled in once the
 * session resolves, because the request helper runs before
 * `requirePortal`/`requireBackOffice` does.
 *
 * `node:async_hooks` is Node-only — this module must never be imported from
 * `apps/web/middleware.ts` (edge runtime). Rate limiting, which middleware
 * does need, lives at the `@cc/observability/rate-limit` subpath precisely
 * so an edge import never pulls this in.
 */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Mutates the active context in place, so every log line and span emitted
 * for the rest of *this* request carries the tenant — not just ones after a
 * fresh `runWithContext` call. A no-op outside a request (e.g. a worker loop
 * that manages its own context) rather than a throw: attaching a tenant is
 * best-effort, and a missing one only means logs correlate by requestId
 * alone.
 */
export function setContextTenant(tenantId: string, userId?: string): void {
  const store = storage.getStore();
  if (!store) return;
  store.tenantId = tenantId;
  if (userId) store.userId = userId;
}
