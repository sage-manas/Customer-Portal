import { hasPermission } from "@cc/domain";
import { displayStatus, getOrder, isOrderError } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  Money,
  O2CTimeline,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import { Download } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderActions } from "./OrderActions";

import { getSession } from "@/lib/session";

/**
 * Order Status & Confirmation (docs/03 Screen 4.2, docs/05 §7.4):
 * "`O2CTimeline` on top; status cards: GBSTK overall, **CMGST credit
 * status** (Blocked → prominent danger card), confirmed qty/date (VBEP),
 * order-confirmation PDF download (BA00 output)."
 *
 * Everything is read from SAP per request, with its freshness on the header
 * — an order's status is exactly the kind of thing a customer refreshes to
 * check, so a cached answer here would be worse than a slow one (docs/05 P1).
 */

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ vbeln: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const detail = await getOrder(sap, session.kunnr, vbeln).catch((error: unknown) => {
    // Another customer's order and an order that never existed give the same
    // answer, deliberately (CLAUDE.md rule 5).
    if (isOrderError(error) && error.code === "not_found") notFound();
    throw error;
  });

  const { order } = detail;
  const blocked = order.creditStatus === "CreditHold";

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/orders" className="hover:text-primary">
          Orders
        </Link>
        <span aria-hidden> / </span>
        <span className="font-mono text-text-mid">{order.vbeln}</span>
      </nav>

      <PageHeader
        title={`Order ${order.vbeln}`}
        subtitle={
          order.customerPoRef
            ? `Your reference ${order.customerPoRef} · placed ${formatDisplayDate(order.createdOn)}`
            : `Placed ${formatDisplayDate(order.createdOn)}`
        }
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
        actions={
          <OrderActions
            vbeln={order.vbeln}
            cancellable={detail.cancellable}
            canCancel={hasPermission(session, "order:cancel")}
            hasDeliveries={detail.deliveries.length > 0}
          />
        }
      />

      {/* The chain, first — doc 05 P4: status is a spine. */}
      <O2CTimeline stages={detail.timeline} currentStage="order" />

      {/* Doc 05 §7.4: a blocked order gets a prominent danger card, not a badge. */}
      {blocked ? (
        <section
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle p-4 shadow-sm"
        >
          <h2 className="text-[13.5px] font-bold text-danger">Order on credit hold</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-danger">
            Our credit team is reviewing this order. Nothing is confirmed or scheduled for delivery
            until it&apos;s released — we&apos;ll email you as soon as it is. Settling open invoices
            usually clears the hold fastest.
          </p>
          <Link
            href="/account"
            className="mt-2 inline-block text-[12px] font-semibold text-danger underline underline-offset-2"
          >
            See your credit position
          </Link>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusCard label="Order status">
          <StatusBadge status={order.orderStatus} />
        </StatusCard>
        <StatusCard label="Credit status">
          <StatusBadge status={displayStatus(order)} />
        </StatusCard>
        <StatusCard label="Order value (ex-GST)">
          <Money value={order.netValue} className="text-[15px] font-bold" />
        </StatusCard>
      </section>

      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold text-text">Items</h2>
          {order.confirmationPdfUrl ? (
            <a
              href={order.confirmationPdfUrl}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
            >
              <Download aria-hidden className="size-3.5" />
              Order confirmation (PDF)
            </a>
          ) : (
            <span className="text-[11.5px] text-text-dim">
              Order confirmation is generated once the order is released.
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                <th scope="col" className="px-4 py-2 font-bold">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Material
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Ordered
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Confirmed
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Confirmed for
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Unit price
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Line value
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => {
                const short = line.confirmedQty !== undefined && line.confirmedQty < line.quantity;
                return (
                  <tr key={line.lineNo} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-text-dim">
                      {line.lineNo}
                    </td>
                    <td className="px-4 py-2.5">
                      <DocumentNumber
                        value={line.material}
                        href={`/catalogue/${encodeURIComponent(line.material)}`}
                      />
                      <p className="text-[11.5px] text-text-mid">{line.description}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-mid">
                      {line.quantity} {line.uom}
                    </td>
                    {/* VBEP-BMENG: what SAP actually committed to. */}
                    <td
                      className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                        short ? "text-warning" : "text-text-mid"
                      }`}
                    >
                      {line.confirmedQty === undefined ? "—" : `${line.confirmedQty} ${line.uom}`}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {line.confirmedDate ? formatDisplayDate(line.confirmedDate) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={line.netPrice} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={line.netValue} className="font-semibold" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-strong bg-background">
                <td colSpan={6} className="px-4 py-2.5 text-right font-semibold text-text-mid">
                  Net value (ex-GST)
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money value={order.netValue} className="font-bold" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <p className="text-[11.5px] text-text-dim">
        GST is calculated by SAP on the invoice — order values here are exclusive of tax.
      </p>
    </>
  );
}

function StatusCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
