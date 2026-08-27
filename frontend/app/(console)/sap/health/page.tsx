import { getTenantHealth, listTenants } from "@cc/service-platform";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { Badge, KpiCard, PageHeader, SapUnavailable } from "@cc/ui";
import Link from "next/link";

import { requireOperatorPage } from "@/lib/page-guard";
import { safeRead } from "@/lib/safe-read";

export const dynamic = "force-dynamic";

/**
 * SAP health across every tenant (doc 09 §3.3: "per-tenant connectivity,
 * last successful call, error rate, queue depth — reuse the B5 health
 * read-model").
 *
 * Reused rather than reimplemented: `getTenantHealth` is B5's read-model
 * unchanged, and this screen adds the one thing it deliberately does not
 * do — an actual probe. That distinction is worth keeping visible on the
 * page: B5's `sapConnectivity` reports which driver a tenant *chose*, and
 * the probe reports whether the driver answered just now. Presenting a
 * configured-but-uncertified ecc tenant as "healthy" because a column says
 * `ecc` is exactly the sort of dashboard that gets believed and shouldn't
 * be.
 *
 * The adapter comes from `@cc/service-sap`, resolved here in the page
 * rather than inside `@cc/service-platform` — a service may not import
 * another service (rule 1), so the app sequences the two (ADR-011).
 */
export default async function SapHealthPage() {
  await requireOperatorPage("platform:sap-health");

  const result = await safeRead(async () => {
    const tenants = await listTenants();

    return Promise.all(
      tenants.map(async (tenant) => {
        const health = await getTenantHealth(tenant.id);
        // A probe that throws is an answer, not a failed page: an unreachable
        // system is the thing this screen exists to show.
        const probe = await getSapAdapterForTenant(tenant.id)
          .then((adapter) => adapter.health())
          .catch((error: unknown) => ({
            reachable: false,
            driver: tenant.sapDriver,
            circuit: "unknown" as const,
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Probe failed",
          }));

        return { tenant, health, probe };
      }),
    );
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="SAP health"
          subtitle="Live probe per tenant, composed on every load and stored nowhere — a health row would be wrong the moment a queue drained (ADR-037)."
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const rows = result.data;

  const unreachable = rows.filter((row) => !row.probe.reachable).length;
  const queued = rows.reduce((sum, row) => sum + row.health.outboxPending, 0);
  const failing = rows.reduce((sum, row) => sum + row.health.outboxFailed, 0);

  return (
    <>
      <PageHeader
        title="SAP health"
        subtitle="Live probe per tenant, composed on every load and stored nowhere — a health row would be wrong the moment a queue drained (ADR-037)."
      />

      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Tenants unreachable"
          value={unreachable}
          subline={unreachable === 0 ? "Every driver answered" : "Probed just now"}
        />
        <KpiCard label="Outbox pending" value={queued} />
        <KpiCard label="Outbox exceptions" value={failing} />
      </div>

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
                Probe
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Circuit
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Queue
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Checked
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                  No tenants provisioned yet.
                </td>
              </tr>
            ) : (
              rows.map(({ tenant, health, probe }) => (
                <tr key={tenant.id} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <Link
                      href={`/sap/config/${tenant.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {tenant.name}
                    </Link>
                    <div className="font-mono text-[11px] text-text-dim">{tenant.slug}</div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <Badge variant={tenant.sapDriver === "mock" ? "neutral" : "warning"}>
                      {tenant.sapDriver}
                    </Badge>
                    {health.sapConnectivity === "not_certified" ? (
                      <div className="mt-1 text-[11px] text-text-dim">Not certified (Track C)</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <Badge variant={probe.reachable ? "success" : "danger"}>
                      {probe.reachable ? "Reachable" : "Unreachable"}
                    </Badge>
                    {"error" in probe && probe.error ? (
                      <div className="mt-1 max-w-[24ch] text-[11px] text-text-dim">
                        {probe.error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">{probe.circuit}</td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {health.outboxPending} pending
                    {health.outboxFailed > 0 ? (
                      <span className="ml-2 text-danger">{health.outboxFailed} exceptions</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top text-text-dim">
                    {new Date(probe.checkedAt).toLocaleTimeString()}
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
