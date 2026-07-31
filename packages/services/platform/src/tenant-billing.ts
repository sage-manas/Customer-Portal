import { createBillingAdapter, type BillingPlan } from "@cc/adapter-billing";

/**
 * Billing is a platform-wide choice, not a per-tenant driver like SAP/GSTN/
 * payment gateway — every tenant is billed by the same provider, so one
 * adapter instance per process is enough (mirrors `@cc/adapter-cache`'s
 * reasoning, not `@cc/service-sap`'s per-tenant factory).
 */
const billingAdapter = createBillingAdapter();

export async function getTenantBilling(tenantId: string): Promise<BillingPlan> {
  return billingAdapter.getPlanForTenant(tenantId);
}
