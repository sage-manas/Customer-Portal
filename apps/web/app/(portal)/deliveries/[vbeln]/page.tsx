import { hasPermission } from "@cc/domain";
import { getDelivery, isDeliveryError } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  Button,
  ComplianceBadge,
  DeliveryTracker,
  DocumentNumber,
  Money,
  O2CTimeline,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/session";

/**
 * Track Delivery (docs/03 Screen 5.1, docs/05 §7.5): "shipment card — status
 * stepper …, planned vs actual GI dates, carrier (TDLNR), AWB (TRAID), E-Way
 * Bill badge".
 *
 * Everything is read from SAP per request, with its freshness on the header
 * (ADR-016) — "where are my goods" is the question a customer refreshes, so a
 * cached answer here would be worse than a slow one (docs/05 P1). The one
 * thing not from SAP is the proof-of-delivery record below, which is the
 * portal's own (ADR-026).
 */

export const dynamic = "force-dynamic";

export default async function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ vbeln: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const detail = await getDelivery(
    sap,
    { tenantId: session.tenantId, kunnr: session.kunnr },
    vbeln,
  ).catch((error: unknown) => {
    // Another customer's delivery and one that never existed give the same
    // answer, deliberately (CLAUDE.md rule 5).
    if (isDeliveryError(error) && error.code === "not_found") notFound();
    throw error;
  });

  const { delivery, pod } = detail;
  const canConfirm = hasPermission(session, "delivery:confirm-receipt");

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/deliveries" className="hover:text-primary">
          Deliveries
        </Link>
        <span aria-hidden> / </span>
        <span className="font-mono text-text-mid">{delivery.vbeln}</span>
      </nav>

      <PageHeader
        title={`Delivery ${delivery.vbeln}`}
        subtitle={`Against order ${delivery.salesOrder}`}
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
        actions={
          detail.podConfirmable && canConfirm ? (
            <Button asChild>
              <Link href={`/deliveries/${delivery.vbeln}/pod`}>Confirm receipt</Link>
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Shipment progress"
        className="rounded-md border border-border bg-surface p-4 shadow-sm md:px-5 md:py-5"
      >
        <DeliveryTracker stages={detail.stages} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim">
            Shipment
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2.5 text-[12.5px]">
            <dt className="text-text-dim">Status</dt>
            <dd>
              <StatusBadge status={delivery.status} />
            </dd>

            <dt className="text-text-dim">Planned dispatch</dt>
            <dd className="text-text-mid">
              {delivery.plannedGoodsIssue ? formatDisplayDate(delivery.plannedGoodsIssue) : "—"}
            </dd>

            <dt className="text-text-dim">Actual dispatch</dt>
            <dd className="text-text-mid">
              {delivery.actualGoodsIssue ? formatDisplayDate(delivery.actualGoodsIssue) : "—"}
            </dd>

            <dt className="text-text-dim">Carrier</dt>
            <dd className="text-text-mid">{delivery.carrier ?? "—"}</dd>

            <dt className="text-text-dim">AWB / tracking</dt>
            <dd className="font-mono text-[12px] text-text-mid">
              {delivery.trackingNumber ?? "—"}
            </dd>

            <dt className="text-text-dim">Sales order</dt>
            <dd>
              <DocumentNumber value={delivery.salesOrder} href={`/orders/${delivery.salesOrder}`} />
            </dd>
          </dl>
        </section>

        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim">
            Compliance
          </h2>
          <div className="mt-3">
            {delivery.ewayBillNumber ? (
              <ComplianceBadge kind="eway" value={delivery.ewayBillNumber} state="verified" />
            ) : detail.ewayBillExpected ? (
              // Reported as a gap, never generated here: e-way bill creation
              // is a GSP integration (Track C), and a portal that invented a
              // number would be making a statutory claim nobody filed.
              <p className="text-[12px] text-text-dim">
                An e-way bill is required for a consignment of this value, but SAP hasn&apos;t
                returned one yet.
              </p>
            ) : (
              <p className="text-[12px] text-text-dim">
                No e-way bill is required for this consignment.
              </p>
            )}
          </div>

          {detail.invoices.length > 0 ? (
            <>
              <h3 className="mt-4 text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim">
                Billing
              </h3>
              <ul className="mt-2 space-y-1">
                {detail.invoices.map((invoice) => (
                  <li key={invoice.vbeln}>
                    <DocumentNumber value={invoice.vbeln} href={`/invoices/${invoice.vbeln}`} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>

      {/* The portal's own record, and the only thing on this screen that
          isn't read from SAP (ADR-026). */}
      {pod ? (
        <section
          className={
            pod.outcome === "discrepancy"
              ? "rounded-md border border-warning-border bg-warning-subtle p-4"
              : "rounded-md border border-border bg-surface p-4 shadow-sm"
          }
        >
          <h2 className="text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim">
            Proof of delivery
          </h2>
          <p className="mt-2 text-[12.5px] text-text-mid">
            {pod.outcome === "discrepancy"
              ? `Receipt recorded on ${formatDisplayDate(pod.receiptDate.toISOString().slice(0, 10))} with a quantity difference. Our team is following it up.`
              : `Receipt confirmed on ${formatDisplayDate(pod.receiptDate.toISOString().slice(0, 10))}.`}
          </p>
          {pod.notes ? (
            <p className="mt-1 text-[12px] text-text-dim">&ldquo;{pod.notes}&rdquo;</p>
          ) : null}

          {pod.outcome === "discrepancy" ? (
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="py-1 font-bold">
                    Material
                  </th>
                  <th scope="col" className="py-1 text-right font-bold">
                    Dispatched
                  </th>
                  <th scope="col" className="py-1 text-right font-bold">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody>
                {pod.lines
                  .filter((line) => line.dispatchedQty !== line.receivedQty)
                  .map((line) => (
                    <tr key={line.lineNo} className="border-t border-border">
                      <td className="py-1.5 font-mono">{line.material}</td>
                      <td className="py-1.5 text-right tabular-nums">{line.dispatchedQty}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {line.receivedQty}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Delivery items</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Item
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Material
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Quantity
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {delivery.lines.map((line) => (
              <tr key={line.lineNo} className="border-t border-border">
                <td className="px-4 py-2.5 tabular-nums text-text-dim">{line.lineNo}</td>
                <td className="px-4 py-2.5">
                  <span className="font-mono">{line.material}</span>
                  {line.description ? (
                    <span className="mt-0.5 block text-[11.5px] text-text-dim">
                      {line.description}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {line.quantity} {line.uom}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money value={line.netValue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail.timeline.length > 0 ? (
        <O2CTimeline stages={detail.timeline} currentStage="delivery" />
      ) : null}
    </>
  );
}
