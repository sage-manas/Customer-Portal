import { db, runWithTenant } from "@cc/db";

/**
 * Usage metering read-model (docs/07 B5). "Read-model" rather than a stored
 * table: every number here is a `count()` against rows the tenant's own
 * services already own, taken at read time — the same choice reports (A6)
 * and credit (A5) made for the same reason (ADR-037/ADR-033), and billing
 * behind `@cc/adapter-billing` is what turns these counts into a plan
 * comparison, never the other way round.
 */

export interface TenantUsage {
  tenantId: string;
  userCount: number;
  salesOrderCount: number;
  supportTicketCount: number;
  paymentCount: number;
}

export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  const [userCount, salesOrderCount, supportTicketCount, paymentCount] = await runWithTenant(
    tenantId,
    () =>
      Promise.all([
        db.user.count(),
        db.salesOrder.count(),
        db.supportTicket.count(),
        db.payment.count(),
      ]),
  );

  return { tenantId, userCount, salesOrderCount, supportTicketCount, paymentCount };
}
