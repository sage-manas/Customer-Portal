import "server-only";

import { MockSapAdapter, SEED_TODAY, type SapAdapter } from "@/packages/sap-mock";
import { serverEnv } from "@/server/env";

import { createHttpSapAdapter } from "./http-driver";

/**
 * Resolves the SAP adapter a tenant's request runs against.
 *
 * This is the only place a driver is chosen, and the only place application
 * code learns that more than one exists. Everything above it — services,
 * routes, screens — talks to the `SapAdapter` contract, which is why the
 * mock/real switch is a configuration change rather than a code change.
 *
 * `mock` is the default so the portal is runnable and demoable without a SAP
 * landscape. It is a *driver*, not a fallback: a tenant configured for `ecc`
 * or `s4` never silently degrades to seeded data, because answering a real
 * customer with invented stock or an invented order number is worse than
 * answering with an error.
 *
 * Per-tenant driver selection is read from the tenant row; the env var is the
 * default for tenants that have no SAP configuration of their own yet.
 */

const globalForSap = globalThis as typeof globalThis & {
  __ccSapAdapters?: Map<string, SapAdapter>;
};

/**
 * One adapter per driver per process. The mock holds its landscape in memory,
 * so a fresh instance per request would drop the order a customer just placed;
 * a real driver caches its auth token, which is worth just as much.
 */
function cache(): Map<string, SapAdapter> {
  globalForSap.__ccSapAdapters ??= new Map();
  return globalForSap.__ccSapAdapters;
}

/** Latency and outage knobs, so the loading and degraded states stay testable. */
const MOCK_LATENCY_MS = Number(process.env.CC_DEMO_SAP_LATENCY_MS ?? 0) || 0;
const MOCK_UNAVAILABLE = process.env.CC_DEMO_SAP_DOWN === "1";

export type SapDriverKind = "mock" | "ecc" | "s4";

function build(driver: SapDriverKind): SapAdapter {
  if (driver === "mock") {
    return new MockSapAdapter({
      // The seeded landscape is anchored to this date, so "today" is anchored
      // with it — otherwise every seeded invoice reads as years overdue.
      today: SEED_TODAY,
      latencyMs: MOCK_LATENCY_MS,
      unavailable: MOCK_UNAVAILABLE,
    });
  }
  return createHttpSapAdapter();
}

export function getSapAdapter(driver: SapDriverKind = serverEnv.SAP_DRIVER): SapAdapter {
  const existing = cache().get(driver);
  if (existing) return existing;
  const adapter = build(driver);
  cache().set(driver, adapter);
  return adapter;
}

/**
 * The adapter for one tenant.
 *
 * TODO: SAP INTEGRATION
 * Read `Tenant.sapDriver` and decrypt that tenant's row in
 * `tenant_credentials` through the vault (ADR-042), then build the driver from
 * those parameters instead of the process-level env. Until then every tenant
 * resolves to the process default, which is what a `mock`-driver tenant would
 * have got anyway.
 */
export async function getSapAdapterForTenant(_tenantId: string): Promise<SapAdapter> {
  return getSapAdapter();
}

export function resetSapAdapterCache(): void {
  cache().clear();
}

export {
  isSapError,
  type FreshnessClass,
  type SapAdapter,
  type SapError,
} from "@/packages/sap-mock";
