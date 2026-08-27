import { hasPermission } from "@cc/domain";
import { listCustomerAccounts } from "@cc/service-customer";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, SapUnavailable, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * The tenant's customer directory (doc 09 §3.4).
 *
 * Every column except the status comes from SAP, read per request and
 * carrying its freshness — the portal stores no copy of a customer's name or
 * GSTIN (ADR-057). The status column is the one thing that is the portal's
 * own: whether this account may still sign in and order.
 */

export const dynamic = "force-dynamic";

const FILTERS: { label: string; status?: "Active" | "Deactivated" }[] = [
  { label: "All" },
  { label: "Active", status: "Active" },
  { label: "Deactivated", status: "Deactivated" },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // 404, not 403: the directory's existence is itself tenant information
  // (CLAUDE.md rule 5), and an AP/AR manager holds the shell but not this.
  if (!hasPermission(session, "customer:register")) notFound();

  const params = await searchParams;
  const active = FILTERS.find((filter) => filter.label === params.status) ?? FILTERS[0]!;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() =>
    listCustomerAccounts(session.tenantId, sap, {
      status: active.status,
      search: params.q,
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Customers"
          subtitle="The accounts registered on your portal. Names and tax details come from SAP; portal access is yours to grant and withdraw."
          actions={
            <Link
              href="/admin/customers/new"
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-dark"
            >
              Register customer
            </Link>
          }
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const read = result.data;
  const customers = read.data;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="The accounts registered on your portal. Names and tax details come from SAP; portal access is yours to grant and withdraw."
        meta={
          customers.length > 0 ? (
            <SapSyncIndicator state={read.freshness} syncedAt={read.syncedAt} />
          ) : undefined
        }
        actions={
          <Link
            href="/admin/customers/new"
            className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-dark"
          >
            Register customer
          </Link>
        }
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <Link
            key={filter.label}
            href={`/admin/customers?status=${encodeURIComponent(filter.label)}`}
            aria-current={filter.label === active.label ? "page" : undefined}
            className={`rounded-pill border px-3 py-1 text-[11.5px] font-medium ${
              filter.label === active.label
                ? "border-primary bg-primary-subtle text-primary"
                : "border-border bg-surface text-text-mid hover:bg-primary-subtle"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        {customers.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-text-dim">
            No customers yet. Approve an application from the onboarding queue, or register one
            yourself.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">Customer accounts</caption>
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  {["Customer", "KUNNR", "GSTIN", "Location", "Logins", "Registered", "Access"].map(
                    (header) => (
                      <th key={header} scope="col" className="px-4 py-2 font-bold">
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.kunnr} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/customers/${customer.kunnr}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {/* Empty when SAP could not be reached for this row —
                            the account still exists, and saying so is more
                            useful than hiding it (ADR-007). */}
                        {customer.legalEntityName || "Name unavailable from SAP"}
                      </Link>
                      <span className="block text-[11px] text-text-dim">
                        {customer.contactEmail ?? "—"}
                        {customer.origin === "back_office" ? " · registered by your team" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-text-mid">
                      {customer.kunnr}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-text-mid">
                      {customer.gstin ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {[customer.city, customer.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">{customer.userCount}</td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {formatDisplayDate(customer.registeredAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                          customer.status === "Active"
                            ? "bg-success-subtle text-success"
                            : "bg-background text-text-dim"
                        }`}
                      >
                        {customer.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
