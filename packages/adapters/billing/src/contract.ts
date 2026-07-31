/**
 * Billing — the one external system docs/07 B5 asks to be stubbed rather
 * than built: "billing integration can stub behind an interface." Contract
 * first, mock driver first, like every other external system (CLAUDE.md
 * rule 2) — a real provider (Stripe/Chargebee-shaped) is a driver swap once
 * the platform actually charges tenants, never an `apps/ops` change.
 */

export type BillingPlanName = "starter" | "growth" | "enterprise";

export interface BillingPlan {
  plan: BillingPlanName;
  seatLimit: number;
  /** Whether this came from a real billing system or the stub. Rendered next
   * to the plan name so the operator never mistakes a placeholder for a
   * contract (the same honesty `SapSyncIndicator` gives a stale SAP read). */
  source: "mock" | "provider";
}

export interface BillingAdapter {
  readonly driver: "mock";
  getPlanForTenant(tenantId: string): Promise<BillingPlan>;
}
