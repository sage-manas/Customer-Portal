import type { BillingAdapter, BillingPlan } from "../contract";

/**
 * Every tenant is on the same stub plan until a real provider exists — there
 * is no pricing decision encoded here, just the shape a real driver will
 * fill in later.
 */
const STUB_PLAN: Omit<BillingPlan, "source"> = { plan: "starter", seatLimit: 10 };

export class MockBillingAdapter implements BillingAdapter {
  readonly driver = "mock" as const;

  async getPlanForTenant(_tenantId: string): Promise<BillingPlan> {
    return { ...STUB_PLAN, source: "mock" };
  }
}
