import { getTenant, getTenantBilling, getTenantHealth, getTenantUsage } from "@cc/service-platform";
import { Badge, KpiCard, PageHeader, SapUnavailable } from "@cc/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TenantAdminPanel } from "./TenantAdminPanel";

import { requireOperatorPage } from "@/lib/page-guard";
import { safeRead } from "@/lib/safe-read";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireOperatorPage("platform:tenant-crud"), params]);

  const result = await safeRead(async () => {
    const tenant = await getTenant(id);
    if (!tenant) notFound();

    const [health, usage, billing] = await Promise.all([
      getTenantHealth(id),
      getTenantUsage(id),
      getTenantBilling(id),
    ]);

    return { tenant, health, usage, billing };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader title={`Tenant ${id}`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const { tenant, health, usage, billing } = result.data;

  return (
    <>
      <PageHeader
        title={tenant.name}
        subtitle={tenant.customDomain ?? `${tenant.slug}.<root-domain>`}
        meta={
          tenant.isActive ? undefined : (
            <Badge variant="danger">Deactivated {tenant.deactivatedAt?.toLocaleDateString()}</Badge>
          )
        }
        actions={
          <Link
            href={`/sap/config/${tenant.id}`}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-text"
          >
            SAP configuration
          </Link>
        }
      />

      <section>
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">Health</h2>
        <div className="mt-2 grid grid-cols-3 gap-4">
          <KpiCard
            label="SAP driver"
            value={
              <Badge variant={health.sapConnectivity === "mock_ok" ? "success" : "warning"}>
                {health.sapDriver}
              </Badge>
            }
            subline={
              health.sapConnectivity === "mock_ok"
                ? "Mock — always available"
                : "Not yet certified (Track C)"
            }
          />
          <KpiCard label="Outbox pending" value={health.outboxPending} />
          <KpiCard label="Outbox exceptions" value={health.outboxFailed} />
        </div>
      </section>

      <section>
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">Usage</h2>
        <div className="mt-2 grid grid-cols-4 gap-4">
          <KpiCard label="Users" value={usage.userCount} />
          <KpiCard label="Sales orders" value={usage.salesOrderCount} />
          <KpiCard label="Support tickets" value={usage.supportTicketCount} />
          <KpiCard label="Payments" value={usage.paymentCount} />
        </div>
      </section>

      <section>
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
          Billing
        </h2>
        <div className="mt-2 rounded-md border border-border bg-surface p-4 text-[12.5px]">
          <span className="font-medium capitalize text-text">{billing.plan}</span>
          <span className="ml-2 text-text-dim">up to {billing.seatLimit} seats</span>
          <Badge variant="neutral" className="ml-2">
            {billing.source}
          </Badge>
          <p className="mt-1 text-[11.5px] text-text-dim">
            Stub billing (docs/07 B5) — no real provider is wired up yet.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
          Administration
        </h2>
        <div className="mt-2">
          <TenantAdminPanel
            tenantId={tenant.id}
            slug={tenant.slug}
            name={tenant.name}
            customDomain={tenant.customDomain}
            isActive={tenant.isActive}
          />
        </div>
      </section>
    </>
  );
}
