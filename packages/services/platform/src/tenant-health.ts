import { db, runWithTenant } from "@cc/db";
import type { GstnDriver, PaymentGatewayDriver, SapDriver } from "@cc/db";
import { classifyOutboxException } from "@cc/domain";

/**
 * Tenant health (docs/07 B5's "tenant health dashboard: queue depth, SAP
 * connectivity, error rates"). Composed on every read, the same reasoning
 * as reports (ADR-037) and reconciliation (ADR-044): a stored health row
 * would be wrong the moment the queue drained, and nothing would say so.
 *
 * The dashboard is inherently cross-tenant, but every read below is still
 * scoped with `runWithTenant` per tenant (rule 4 stays structural) — the
 * operator console loops over `listTenants()` and calls this once per row,
 * rather than any query running unscoped.
 */

export type SapConnectivityStatus = "mock_ok" | "not_certified";

export interface TenantHealth {
  tenantId: string;
  sapDriver: SapDriver;
  gstnDriver: GstnDriver;
  paymentGateway: PaymentGatewayDriver;
  /**
   * `mock_ok`: the mock driver has no external dependency to fail.
   * `not_certified`: `ecc`/`s4` — Track C's real drivers still throw
   * `not_implemented` (docs/07 §4), so this is honest about "chosen" vs
   * "working," not a live ping.
   */
  sapConnectivity: SapConnectivityStatus;
  outboxPending: number;
  outboxFailed: number;
}

function sapConnectivity(driver: SapDriver): SapConnectivityStatus {
  return driver === "mock" ? "mock_ok" : "not_certified";
}

export async function getTenantHealth(tenantId: string): Promise<TenantHealth> {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const [pendingCount, failedRows] = await runWithTenant(tenantId, () =>
    Promise.all([
      db.outboxEvent.count({ where: { state: "pending" } }),
      db.outboxEvent.findMany({
        where: { state: "failed" },
        select: { state: true, occurredAt: true },
      }),
    ]),
  );

  const now = new Date();
  const outboxFailed = failedRows.filter(
    (row) => classifyOutboxException(row, now) !== null,
  ).length;

  return {
    tenantId,
    sapDriver: tenant.sapDriver,
    gstnDriver: tenant.gstnDriver,
    paymentGateway: tenant.paymentGateway,
    sapConnectivity: sapConnectivity(tenant.sapDriver),
    outboxPending: pendingCount,
    outboxFailed,
  };
}
