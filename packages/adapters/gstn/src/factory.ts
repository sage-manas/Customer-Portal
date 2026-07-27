import type { GstnDriverKind } from "@cc/domain";

import type { GstnAdapter } from "./contract";
import { ApiGstnAdapter, type GstnApiConfig } from "./drivers/api";
import { GstnError } from "./errors";
import { MockGstnAdapter, type MockGstnOptions } from "./mock/driver";

/**
 * Per-tenant driver resolution, the same shape as the SAP factory: this is
 * the only place a concrete GSTN driver is constructed, and adapters are
 * cached per tenant so connection/rate-limit state survives across requests.
 */

export interface GstnTenantConfig {
  tenantId: string;
  driver: GstnDriverKind;
  api?: GstnApiConfig;
  mock?: MockGstnOptions;
}

const adapters = new Map<string, GstnAdapter>();

function build(config: GstnTenantConfig): GstnAdapter {
  switch (config.driver) {
    case "mock":
      return new MockGstnAdapter(config.mock);
    case "api":
      if (!config.api) {
        throw new GstnError(
          `Tenant ${config.tenantId} is configured for the GSTN API driver but has no connection settings`,
          { kind: "not_implemented" },
        );
      }
      return new ApiGstnAdapter(config.api);
    default: {
      const exhaustive: never = config.driver;
      throw new GstnError(`Unknown GSTN driver: ${String(exhaustive)}`, {
        kind: "not_implemented",
      });
    }
  }
}

export function createGstnAdapter(config: GstnTenantConfig): GstnAdapter {
  const cacheKey = `${config.tenantId}::${config.driver}`;
  const cached = adapters.get(cacheKey);
  if (cached) return cached;

  const adapter = build(config);
  adapters.set(cacheKey, adapter);
  return adapter;
}

/** Drops cached adapters — after a config change, and between tests. */
export function resetGstnAdapter(tenantId?: string): void {
  if (!tenantId) {
    adapters.clear();
    return;
  }
  for (const key of adapters.keys()) {
    if (key.startsWith(`${tenantId}::`)) adapters.delete(key);
  }
}
