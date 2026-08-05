import { getTenantSapConfig, listTenants } from "@cc/service-platform";
import { Badge, PageHeader } from "@cc/ui";
import Link from "next/link";

import { requireOperatorPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

/**
 * SAP configuration index — the tenant picker both platform roles share
 * (doc 09 §3.3: "manages SAP connections of **all** tenants").
 *
 * It reads `listTenants()`, which is also what the CRUD index reads, and
 * that is fine: the permission on this *screen* is `platform:sap-config`,
 * and what a `sap_manager` gets from it is a name, a slug and a driver —
 * no usage, no billing, no provisioning action, no deactivation. The
 * distinction doc 09 draws between the two roles is over capabilities, not
 * over the existence of tenants; a SAP manager who could not see which
 * tenants exist could not configure their connections.
 */
export default async function SapConfigIndexPage() {
  await requireOperatorPage("platform:sap-config");

  const tenants = await listTenants();
  const configs = await Promise.all(tenants.map((tenant) => getTenantSapConfig(tenant.id)));

  return (
    <>
      <PageHeader
        title="SAP configuration"
        subtitle="Per-tenant driver and connection parameters. Credentials are stored envelope-encrypted (ADR-042) and never shown back."
      />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Tenant
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Driver
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Connection
              </th>
              <th scope="col" className="px-4 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-text-dim">
                  No tenants provisioned yet.
                </td>
              </tr>
            ) : (
              tenants.map((tenant, index) => {
                const config = configs[index];
                const missing = config?.missing ?? [];
                return (
                  <tr key={tenant.id} className="border-t border-border">
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-medium text-text">{tenant.name}</div>
                      <div className="font-mono text-[11px] text-text-dim">{tenant.slug}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <Badge variant={tenant.sapDriver === "mock" ? "neutral" : "warning"}>
                        {tenant.sapDriver}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 align-top text-text-mid">
                      {tenant.sapDriver === "mock" ? (
                        <span className="text-text-dim">No connection needed</span>
                      ) : missing.length > 0 ? (
                        <span className="text-danger">Incomplete — {missing.join(", ")} unset</span>
                      ) : (
                        <span className="text-success">Configured</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <Link
                        href={`/sap/config/${tenant.id}`}
                        className="text-primary hover:underline"
                      >
                        Configure
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
