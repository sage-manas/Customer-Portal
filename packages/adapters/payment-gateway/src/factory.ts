import type { PaymentGatewayKind } from "@cc/domain";

import type { PaymentGateway } from "./contract";
import { RazorpayGateway, type RazorpayConfig } from "./drivers/razorpay";
import { PaymentGatewayError } from "./errors";
import { MockPaymentGateway, type MockPaymentGatewayOptions } from "./mock/driver";

/**
 * Per-tenant driver resolution, the same shape as the SAP and GSTN
 * factories: the only place a concrete gateway is constructed, cached per
 * tenant so the mock's in-memory payment state survives across requests
 * within a process (a mock that forgot its orders between the redirect and
 * the webhook would be untestable).
 */

export interface PaymentGatewayTenantConfig {
  tenantId: string;
  driver: PaymentGatewayKind;
  razorpay?: RazorpayConfig;
  mock?: MockPaymentGatewayOptions;
}

const gateways = new Map<string, PaymentGateway>();

function build(config: PaymentGatewayTenantConfig): PaymentGateway {
  switch (config.driver) {
    case "mock":
      return new MockPaymentGateway(config.mock);
    case "razorpay":
      if (!config.razorpay) {
        throw new PaymentGatewayError(
          `Tenant ${config.tenantId} is configured for Razorpay but has no gateway settings`,
          { kind: "not_implemented" },
        );
      }
      return new RazorpayGateway(config.razorpay);
    default: {
      const exhaustive: never = config.driver;
      throw new PaymentGatewayError(`Unknown payment gateway driver: ${String(exhaustive)}`, {
        kind: "not_implemented",
      });
    }
  }
}

export function createPaymentGateway(config: PaymentGatewayTenantConfig): PaymentGateway {
  const cacheKey = `${config.tenantId}::${config.driver}`;
  const cached = gateways.get(cacheKey);
  if (cached) return cached;

  const gateway = build(config);
  gateways.set(cacheKey, gateway);
  return gateway;
}

/** Drops cached gateways — after a config change, and between tests. */
export function resetPaymentGateway(tenantId?: string): void {
  if (!tenantId) {
    gateways.clear();
    return;
  }
  for (const key of gateways.keys()) {
    if (key.startsWith(`${tenantId}::`)) gateways.delete(key);
  }
}
