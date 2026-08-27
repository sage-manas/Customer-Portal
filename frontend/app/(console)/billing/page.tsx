import { getTenantBilling, getTenantUsage, listTenants } from "@cc/service-platform";
import { Badge, PageHeader, SapUnavailable } from "@cc/ui";

import { requireOperatorPage } from "@/lib/page-guard";
import { safeRead } from "@/lib/safe-read";

export const dynamic = "force-dynamic";

/**
 * Billing (doc 09 §3.3: "billing stub"), `super_admin` only.
 *
 * Still a stub, and the screen says so rather than looking finished: every
 * plan below comes from `@cc/adapter-billing`'s mock driver, and no invoice
 * has ever been raised by this platform. What is real is the pairing — a
 * plan's seat limit next to the tenant's actual user count — because that
 * is the number a billing conversation starts from, and it is composed from
 * the usage read-model rather than stored anywhere (docs/07 B5).
 */
export default async function BillingPage() {
  await requireOperatorPage("platform:billing");

  const result = await safeRead(async () => {
    const tenants = await listTenants();
    return Promise.all(
      tenants.map(async (tenant) => ({
        tenant,
        billing: await getTenantBilling(tenant.id),
        usage: await getTenantUsage(tenant.id),
      })),
    );
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Billing"
          subtitle="Stubbed behind @cc/adapter-billing — plans are simulated and nothing here charges anyone."
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const rows = result.data;

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Stubbed behind @cc/adapter-billing — plans are simulated and nothing here charges anyone."
      />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Tenant
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Plan
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Seats
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-text-dim">
                  No tenants provisioned yet.
                </td>
              </tr>
            ) : (
              rows.map(({ tenant, billing, usage }) => (
                <tr key={tenant.id} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <div className="font-medium text-text">{tenant.name}</div>
                    <div className="font-mono text-[11px] text-text-dim">{tenant.slug}</div>
                  </td>
                  <td className="px-4 py-2.5 align-top capitalize text-text-mid">{billing.plan}</td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {usage.userCount} of {billing.seatLimit}
                    {usage.userCount > billing.seatLimit ? (
                      <Badge variant="warning" className="ml-2">
                        Over
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <Badge variant="neutral">{billing.source}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
