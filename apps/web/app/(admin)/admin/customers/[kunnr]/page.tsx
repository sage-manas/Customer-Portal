import { hasPermission } from "@cc/domain";
import { getCustomerAccount, isCustomerError } from "@cc/service-customer";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AccessPanel } from "./AccessPanel";
import { CustomerEditPanel } from "./CustomerEditPanel";

import { getSession } from "@/lib/session";

/**
 * One customer (doc 09 §3.4): the SAP master on the left, the portal's own
 * two facts on the right — who can sign in for this account, and whether
 * they still may.
 */

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ kunnr: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "customer:register")) notFound();

  const { kunnr } = await params;
  const sap = await getSapAdapterForTenant(session.tenantId);

  const detail = await getCustomerAccount(session.tenantId, kunnr, sap).catch((error: unknown) => {
    // A customer of another tenant lands here as `not_found` — the service
    // never distinguishes it from one that does not exist.
    if (isCustomerError(error) && error.code === "not_found") notFound();
    throw error;
  });

  const { summary, customer } = detail;
  const canEdit = hasPermission(session, "customer:edit");

  return (
    <>
      <PageHeader
        title={summary.legalEntityName || `Customer ${summary.kunnr}`}
        subtitle={`${summary.kunnr}${summary.gstin ? ` · ${summary.gstin}` : ""}`}
        meta={
          detail.freshness ? (
            <SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />
          ) : undefined
        }
        actions={
          <Link href="/admin/customers" className="text-[12.5px] text-primary hover:underline">
            ← All customers
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-[13px] font-bold text-text">Customer master</h2>
          {customer ? (
            <CustomerEditPanel kunnr={summary.kunnr} customer={customer} disabled={!canEdit} />
          ) : (
            <p className="text-[12.5px] text-text-dim">
              SAP couldn&apos;t be reached for this account, so there is nothing to show or edit
              here yet. The portal-side details on the right are unaffected.
            </p>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold text-text">Portal access</h2>
            <AccessPanel
              kunnr={summary.kunnr}
              legalEntityName={summary.legalEntityName || summary.kunnr}
              isActive={summary.status === "Active"}
              deactivationReason={summary.deactivationReason}
            />
            {!hasPermission(session, "customer:deactivate") ? (
              <p className="mt-2 text-[11.5px] text-text-dim">
                You can view this, but changing it needs the customer-administration permission.
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold text-text">Logins</h2>
            {detail.users.length === 0 ? (
              <p className="text-[12.5px] text-text-dim">
                Nobody can sign in for this account yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.users.map((user) => (
                  <li key={user.id} className="text-[12.5px]">
                    <span className="text-text">{user.email}</span>
                    <span className="block text-[11px] text-text-dim">
                      {user.isActive ? "Active" : "Disabled"} ·{" "}
                      {user.lastLoginAt
                        ? `last signed in ${formatDisplayDate(user.lastLoginAt)}`
                        : "never signed in"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold text-text">Provenance</h2>
            <dl className="flex flex-col gap-1.5 text-[12.5px]">
              <div className="flex justify-between gap-2">
                <dt className="text-text-dim">Registered</dt>
                <dd className="text-text">{formatDisplayDate(summary.registeredAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-dim">Origin</dt>
                <dd className="text-text">
                  {summary.origin === "back_office" ? "Registered by your team" : "Self-registered"}
                </dd>
              </div>
              {summary.deactivatedAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-text-dim">Deactivated</dt>
                  <dd className="text-text">{formatDisplayDate(summary.deactivatedAt)}</dd>
                </div>
              ) : null}
              {detail.onboardingApplicationId ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-text-dim">Application</dt>
                  <dd>
                    <Link
                      href={`/admin/onboarding/${detail.onboardingApplicationId}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
