import { getTenantHealth, listTenants } from "@cc/service-platform";
import { Badge, KpiCard, PageHeader } from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getOperatorSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Tenant health dashboard (docs/07 B5). Composed on every load, never
 * stored (ADR-045, mirroring ADR-037/ADR-044): `listTenants()` is the
 * platform-plane registry, and `getTenantHealth` is called once per tenant
 * through its own `runWithTenant` scope rather than any cross-tenant query
 * running unscoped — the console loops, the database stays structural
 * (rule 4).
 */
export default async function OpsDashboardPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/login");

  const tenants = await listTenants();
  const health = await Promise.all(tenants.map((tenant) => getTenantHealth(tenant.id)));
  const healthByTenant = new Map(health.map((h) => [h.tenantId, h]));

  const totalOutboxFailed = health.reduce((sum, h) => sum + h.outboxFailed, 0);
  const totalOutboxPending = health.reduce((sum, h) => sum + h.outboxPending, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
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

      <div className="mt-6 grid grid-cols-3 gap-4">
        <KpiCard label="Tenants" value={tenants.length} />
        <KpiCard label="Outbox pending" value={totalOutboxPending} />
        <KpiCard label="Outbox exceptions" value={totalOutboxFailed} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Tenant
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
                <td colSpan={4} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
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
    </main>
  );
}
