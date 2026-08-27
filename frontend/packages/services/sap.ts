/**
 * Frontend-only stand-in for `@cc/service-sap`.
 *
 * The real package resolves a tenant's SAP driver from the encrypted
 * credential vault (ADR-042) and caches one adapter per tenant. Here every
 * tenant gets the same in-memory mock landscape, which is exactly what a
 * `mock`-driver tenant already got in /client — so every screen that reads
 * SAP renders the same data it rendered before.
 *
 * TODO(BACKEND):
 * Restore the credential-vault lookup and the ecc/s4 drivers.
 */

import { demoSapAdapter } from "./_demo";

import type { SapAdapter } from "../sap-mock";

export async function getSapAdapterForTenant(_tenantId: string): Promise<SapAdapter> {
  return demoSapAdapter();
}

export function resetSapAdapterForTenant(_tenantId: string): void {
  /* No per-tenant cache to evict in demo mode. */
}

export { isSapError, type FreshnessClass, type SapError } from "../sap-mock";
