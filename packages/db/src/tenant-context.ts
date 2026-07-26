import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Binds a tenant to every DB call made within `fn`. In the app, this is
 * called once per request from the resolved subdomain + JWT `tenantId`
 * claim (docs/02-TRD-ARCHITECTURE.md §2).
 *
 * Must `await fn()` *inside* the `storage.run` callback, not just return
 * it: Prisma query results are lazy thenables that don't start executing
 * (and don't invoke the tenant-scoping extension) until `.then()`/`await`
 * touches them. If we returned the un-awaited promise here, that `.then()`
 * would fire back in the caller's frame, after `storage.run` had already
 * exited — losing the AsyncLocalStorage context and defeating scoping.
 */
export async function runWithTenant<T>(tenantId: string, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ tenantId }, async () => fn());
}

/**
 * Reads the bound tenant context. Throws if no tenant is bound — a query
 * without tenant context must fail loudly, never fall through unscoped
 * (docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md).
 */
export function getTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "No tenant context bound. Wrap this call in runWithTenant(tenantId, ...) — queries must never run unscoped.",
    );
  }
  return ctx;
}

export function getTenantId(): string {
  return getTenantContext().tenantId;
}
