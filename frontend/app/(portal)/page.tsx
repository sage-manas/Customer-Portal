import { getDashboardSummary } from "@cc/service-reporting";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  KpiCard,
  Money,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import { CreditCard, Headphones, Package, Receipt } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Customer Dashboard (docs/05-UI-UX-DESIGN.md §7.0): hero band, KPI row of
 * four, and the two recent-document tables.
 *
 * Every value here comes from the tenant's `SapAdapter` through
 * `@cc/service-sap` — on a mock-driver tenant that is the seeded landscape,
 * on an ECC/S/4 tenant it will be the real system, and this file doesn't
 * change either way. Freshness is rendered from the read itself, never
 * assumed (docs/05 P1).
 */

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="No customer account linked yet"
          body="Your login isn't linked to a sold-to account. Ask your administrator to link one, and your orders, invoices and credit position will appear here."
        />
      </>
    );
  }

  const kunnr = session.kunnr;
  const adapter = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() => getDashboardSummary(adapter, kunnr));

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Your order-to-cash position at a glance." />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const summary = result.data;
  const { kpis } = summary;
  const utilisation = kpis.credit?.creditLimit
    ? Math.round((kpis.credit.utilized / kpis.credit.creditLimit) * 100)
    : null;

  return (
    <>
      {summary.freshness === "stale" ? <StaleDataBanner syncedAt={summary.syncedAt} /> : null}

      <PageHeader
        title="Dashboard"
        subtitle="Your order-to-cash position at a glance."
        meta={<SapSyncIndicator state={summary.freshness} syncedAt={summary.syncedAt} />}
      />

      <section className="rounded-md bg-nav p-6 text-white shadow-lg">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-white/60">
          Customer account
        </p>
        <p className="mt-1 font-mono text-[15px] font-semibold">{session.kunnr}</p>
        <p className="mt-0.5 text-[12.5px] text-white/70">{session.email}</p>
      </section>

      {summary.hasCreditHold ? (
        <div
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          One or more of your orders is on credit hold. Our credit team is reviewing it.{" "}
          <Link
            href="/orders?filter=creditHold"
            className="font-semibold underline underline-offset-2"
          >
            See which orders
          </Link>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Doc 05 §7.0: each KPI clicks through to its module with the
            filter pre-applied — now that Orders is built. */}
        <KpiCard
          label="Open Orders"
          value={String(kpis.openOrders.count)}
          subline={<Money value={kpis.openOrders.value} />}
          icon={Package}
          accent="order"
          href="/orders?filter=open"
        />
        <KpiCard
          label="Pending Invoices"
          value={String(kpis.pendingInvoices.count)}
          subline={<Money value={kpis.pendingInvoices.value} />}
          icon={Receipt}
          accent="invoice"
          href="/invoices?filter=open"
        />
        <KpiCard
          label="Available Credit"
          value={kpis.credit ? <Money value={kpis.credit.available} /> : "—"}
          subline={utilisation === null ? "No credit master" : `${utilisation}% of limit utilised`}
          icon={CreditCard}
          accent="payment"
          href="/payments"
        />
        <KpiCard
          label="Open Tickets"
          value={kpis.openTickets === null ? "—" : String(kpis.openTickets)}
          subline={kpis.openTickets === null ? "Support arrives in a later phase" : "SLA tracked"}
          icon={Headphones}
          accent="support"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Recent Orders">
          {summary.recentOrders.length === 0 ? (
            <EmptyRow message="No orders yet — browse the catalogue to place your first one." />
          ) : (
            <Table headers={["Order", "Date", "Value", "Status"]}>
              {summary.recentOrders.map((order) => (
                <tr key={order.vbeln} className="border-t border-border">
                  <Cell>
                    <DocumentNumber value={order.vbeln} href={`/orders/${order.vbeln}`} />
                  </Cell>
                  <Cell>{formatDisplayDate(order.createdOn)}</Cell>
                  <Cell className="text-right">
                    <Money value={order.netValue} />
                  </Cell>
                  <Cell>
                    <StatusBadge
                      status={
                        order.creditStatus === "CreditHold" ? "CreditHold" : order.orderStatus
                      }
                    />
                  </Cell>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Recent Invoices">
          {summary.recentInvoices.length === 0 ? (
            <EmptyRow message="No invoices yet." />
          ) : (
            <Table headers={["Invoice", "Date", "Amount", "Status"]}>
              {summary.recentInvoices.map((invoice) => (
                <tr key={invoice.vbeln} className="border-t border-border">
                  <Cell>
                    <DocumentNumber value={invoice.vbeln} href={`/invoices/${invoice.vbeln}`} />
                  </Cell>
                  <Cell>{formatDisplayDate(invoice.billingDate)}</Cell>
                  <Cell className="text-right">
                    <Money value={invoice.grossAmount} />
                  </Cell>
                  <Cell>
                    <StatusBadge status={invoice.status} />
                  </Cell>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <h2 className="border-b border-border px-4 py-3 text-[15px] font-bold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={`px-4 py-2 font-bold ${index === 2 ? "text-right" : ""}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 text-text-mid ${className}`}>{children}</td>;
}

function EmptyRow({ message }: { message: string }) {
  return <p className="px-4 py-6 text-[12.5px] text-text-dim">{message}</p>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-md border border-border bg-surface p-8 text-center shadow-sm">
      <h2 className="text-[15px] font-bold text-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[12.5px] text-text-dim">{body}</p>
    </section>
  );
}
