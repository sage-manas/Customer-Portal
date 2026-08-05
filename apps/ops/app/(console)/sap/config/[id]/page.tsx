import { sapConfigActionLabel } from "@cc/domain";
import { getTenantSapConfig, listSapConfigAudit } from "@cc/service-platform";
import { Badge, PageHeader } from "@cc/ui";
import { notFound } from "next/navigation";

import { SapConfigForm } from "./SapConfigForm";

import { requireOperatorPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

/**
 * One tenant's SAP connection, plus the append-only trail of who changed it
 * (doc 09 §3.3). The two are on one screen deliberately: a configuration
 * screen that hides its history makes "when did this tenant stop working?"
 * a question for the database.
 */
export default async function SapConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireOperatorPage("platform:sap-config"), params]);

  const config = await getTenantSapConfig(id).catch(() => null);
  if (!config) notFound();

  const trail = await listSapConfigAudit(id, 25);

  return (
    <>
      <PageHeader
        title={config.tenantName}
        subtitle="SAP driver and connection parameters. Secrets are envelope-encrypted per tenant (ADR-042) and never rendered back into this form."
        meta={
          config.missing.length > 0 ? (
            <Badge variant="danger">Incomplete</Badge>
          ) : (
            <Badge variant="neutral">{config.driver}</Badge>
          )
        }
      />

      <div className="max-w-xl">
        <SapConfigForm tenantId={config.tenantId} driver={config.driver} fields={config.fields} />
      </div>

      <section>
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
          Configuration history
        </h2>
        <p className="mt-1 text-[11.5px] text-text-dim">
          Append-only. Field names are recorded, never values — the trail is not a second copy of
          the credential store.
        </p>

        <div className="mt-2 overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                <th scope="col" className="px-4 py-2 font-bold">
                  When
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Operator
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Action
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {trail.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-text-dim">
                    Nothing has changed this tenant&apos;s SAP configuration yet.
                  </td>
                </tr>
              ) : (
                trail.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-2.5 align-top text-text-mid">
                      {entry.createdAt.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 align-top text-text-mid">{entry.operatorEmail}</td>
                    <td className="px-4 py-2.5 align-top text-text">
                      {sapConfigActionLabel(entry.action)}
                    </td>
                    <td className="px-4 py-2.5 align-top text-text-dim">
                      {entry.fromDriver && entry.toDriver
                        ? `${entry.fromDriver} → ${entry.toDriver}`
                        : entry.changedFields.length > 0
                          ? entry.changedFields.join(", ")
                          : (entry.result ?? "—")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
