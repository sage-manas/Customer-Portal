import type { SapDriverKind } from "@cc/domain";

import type { SapAdapter } from "./contract";
import { EccSapAdapter, type EccConnectionConfig } from "./drivers/ecc";
import { S4SapAdapter, type S4ConnectionConfig } from "./drivers/s4";
import { SapError } from "./errors";
import { MockSapAdapter, type MockSapOptions } from "./mock/driver";

/**
 * Per-tenant adapter resolution (docs/06: "adapter factory resolved per
 * tenant"). This is the *only* place a concrete driver is constructed —
 * app and service code depends on `SapAdapter`, so swapping a tenant from
 * mock to a real system is a config change, not a code change.
 *
 * Adapters are cached per tenant: a driver instance owns connection state
 * (pool, circuit breaker, and for the mock, its mutable store), so building
 * a fresh one per request would both lose that state and defeat the
 * per-tenant circuit breaker in docs/02 §4.3.
 */

export interface SapTenantConfig {
  tenantId: string;
  driver: SapDriverKind;
  /** Driver-specific connection settings; required for ecc/s4. */
  ecc?: EccConnectionConfig;
  s4?: S4ConnectionConfig;
  /** Mock-only knobs (outage simulation, latency) for demo/trial tenants. */
  mock?: MockSapOptions;
}

const adapters = new Map<string, SapAdapter>();

function build(config: SapTenantConfig): SapAdapter {
  switch (config.driver) {
    case "mock":
      return new MockSapAdapter(config.mock);
    case "ecc":
      if (!config.ecc) {
        throw new SapError(
          `Tenant ${config.tenantId} is configured for the ECC driver but has no ECC connection settings`,
          { kind: "validation" },
        );
      }
      return new EccSapAdapter(config.ecc);
    case "s4":
      if (!config.s4) {
        throw new SapError(
          `Tenant ${config.tenantId} is configured for the S/4 driver but has no S/4 connection settings`,
          { kind: "validation" },
        );
      }
      return new S4SapAdapter(config.s4);
    default: {
      const exhaustive: never = config.driver;
      throw new SapError(`Unknown SAP driver: ${String(exhaustive)}`, { kind: "validation" });
    }
  }
}

/** Returns the tenant's adapter, constructing and caching it on first use. */
export function createSapAdapter(config: SapTenantConfig): SapAdapter {
  const cacheKey = `${config.tenantId}::${config.driver}`;
  const cached = adapters.get(cacheKey);
  if (cached) return cached;

  const adapter = build(config);
  adapters.set(cacheKey, adapter);
  return adapter;
}

/**
 * Drops a tenant's cached adapter — call after its SAP connection config
 * changes (credential rotation, driver switch), and between tests so mock
 * store mutations don't leak across cases.
 */
export function resetSapAdapter(tenantId?: string): void {
  if (!tenantId) {
    adapters.clear();
    return;
  }
  for (const key of adapters.keys()) {
    if (key.startsWith(`${tenantId}::`)) adapters.delete(key);
  }
}
