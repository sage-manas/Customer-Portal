import { getTenantHealth, listTenants } from "@cc/service-platform";
import { Badge, KpiCard, PageHeader, SapUnavailable } from "@cc/ui";
import Link from "next/link";

import { requireOperatorPage } from "@/lib/page-guard";
import { safeRead } from "@/lib/safe-read";

export const dynamic = "force-dynamic";

/**
 * Tenant list — CRUD's index (docs/07 B5, doc 09 §3.3), and `super_admin`
 * only: a `sap_manager` configures every tenant's SAP connection and
 * provisions none of them, so this screen is not theirs and `/sap/config`
 * is.
 *
 * Composed on every load, never stored (ADR-045, mirroring ADR-037/ADR-044):
 * `listTenants()` is the platform-plane registry, and `getTenantHealth` is
 * called once per tenant through its own `runWithTenant` scope rather than
 * any cross-tenant query running unscoped — the console loops, the database
 * stays structural (rule 4).
 */
export default async function TenantsPage() {
  await requireOperatorPage("platform:tenant-crud");

  const result = await safeRead(async () => {
    const tenants = await listTenants();
    const health = await Promise.all(tenants.map((tenant) => getTenantHealth(tenant.id)));
    return { tenants, health };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Tenants"
          subtitle="Platform operator console — provisioning and health, not tenant or customer data."
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const { tenants, health } = result.data;
  const healthByTenant = new Map(health.map((h) => [h.tenantId, h]));

  const totalOutboxFailed = health.reduce((sum, h) => sum + h.outboxFailed, 0);
  const totalOutboxPending = health.reduce((sum, h) => sum + h.outboxPending, 0);
  const deactivated = tenants.filter((tenant) => !tenant.isActive).length;

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle="Platform operator console — provisioning and health, not tenant or customer data."
        actions={
          <Link
            href="/tenants/new"
            className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white"
          >
            Provision tenant
          </Link>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Tenants"
          value={tenants.length}
          subline={deactivated === 0 ? "All active" : `${deactivated} deactivated`}
        />
        <KpiCard label="Outbox pending" value={totalOutboxPending} />
        <KpiCard label="Outbox exceptions" value={totalOutboxFailed} />
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Tenant
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                SAP driver
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Queue
              </th>
              <th scope="col" className="px-4 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
                  No tenants provisioned yet.
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => {
                const tenantHealth = healthByTenant.get(tenant.id);
                return (
                  <tr key={tenant.id} className="border-t border-border">
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-medium text-text">{tenant.name}</div>
                      <div className="font-mono text-[11px] text-text-dim">{tenant.slug}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <Badge variant={tenant.isActive ? "success" : "danger"}>
                        {tenant.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 align-top text-text-mid">
                      <Badge variant={tenant.sapDriver === "mock" ? "neutral" : "warning"}>
                        {tenant.sapDriver}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 align-top text-text-mid">
                      {tenantHealth ? (
                        <>
                          {tenantHealth.outboxPending} pending
                          {tenantHealth.outboxFailed > 0 ? (
                            <span className="ml-2 text-danger">
                              {tenantHealth.outboxFailed} exceptions
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <Link href={`/tenants/${tenant.id}`} className="text-primary hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
