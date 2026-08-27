import { hasPermission } from "@cc/domain";
import { listDeliveries, type DeliveryStatusFilter } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  ComplianceBadge,
  DeliveryTracker,
  DocumentNumber,
  PageHeader,
  Pager,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DeliveryFilterChips } from "./DeliveryFilterChips";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Delivery list (docs/05 §7.5).
 *
 * Rendered on the server from SAP reads, with their freshness on the header.
 * Nothing about a shipment is stored (ADR-016) — the portal's only delivery
 * data is the proof of delivery, and that lives on the detail screen.
 *
 * Shipments still moving sort above ones already delivered: a customer opens
 * this screen asking "where are my goods?", not "what arrived last month".
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly DeliveryStatusFilter[] = ["all", "inTransit", "awaitingPod", "delivered"];
const PAGE_SIZE = 10;

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "all";
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const offset = Math.max(0, Number(pageParam ?? 1) - 1) * PAGE_SIZE;

  const canConfirm = hasPermission(session, "delivery:confirm-receipt");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Deliveries" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no deliveries to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const kunnr = session.kunnr;
  const read = await safeRead(() =>
    listDeliveries(sap, kunnr, { filter, limit: PAGE_SIZE, offset }),
  );

  if (!read.ok) {
    return (
      <>
        <PageHeader title="Deliveries" />
        <SapUnavailable reason={read.reason} />
      </>
    );
  }

  const result = read.data;

  const awaiting = result.awaitingCount;

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Deliveries"
        subtitle={`Shipments for account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
      />

      <DeliveryFilterChips active={filter} />

      {/* The one thing on this screen that needs the customer to act. */}
      {canConfirm && awaiting > 0 && filter !== "awaitingPod" ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-2.5 text-[12.5px] text-text-mid">
          {awaiting === 1
            ? "One delivery is waiting for you to confirm receipt."
            : `${awaiting} deliveries are waiting for you to confirm receipt.`}{" "}
          <Link
            href="/deliveries?filter=awaitingPod"
            className="font-semibold underline-offset-2 hover:underline"
          >
            Show them
          </Link>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Delivery
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Order
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Progress
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Dispatched
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Carrier / AWB
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.deliveries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all"
                      ? "No deliveries yet. They appear here once an order has been picked."
                      : "No deliveries match this filter right now."}
                  </p>
                  {/* Doc 05 §6.3: an empty state carries its next step. */}
                  <Link
                    href="/orders"
                    className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    See your orders
                  </Link>
                </td>
              </tr>
            ) : (
              result.deliveries.map((delivery) => (
                <tr key={delivery.vbeln} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber value={delivery.vbeln} href={`/deliveries/${delivery.vbeln}`} />
                    {delivery.awaitingPod && canConfirm ? (
                      <Link
                        href={`/deliveries/${delivery.vbeln}/pod`}
                        className="mt-1 block text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Confirm receipt
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber
                      value={delivery.salesOrder}
                      href={`/orders/${delivery.salesOrder}`}
                    />
                  </td>
                  <td className="min-w-[260px] px-4 py-2.5 align-top">
                    <DeliveryTracker stages={delivery.stages} dense />
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {delivery.actualGoodsIssue ? (
                      formatDisplayDate(delivery.actualGoodsIssue)
                    ) : delivery.plannedGoodsIssue ? (
                      <span className="text-text-dim">
                        planned {formatDisplayDate(delivery.plannedGoodsIssue)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    {delivery.carrier ? (
                      <>
                        <span className="text-text-mid">{delivery.carrier}</span>
                        {delivery.trackingNumber ? (
                          <span className="mt-0.5 block font-mono text-[11px] text-text-dim">
                            {delivery.trackingNumber}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                    {delivery.ewayBillNumber ? (
                      <ComplianceBadge
                        kind="eway"
                        value={delivery.ewayBillNumber}
                        className="mt-1"
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <StatusBadge status={delivery.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager
        total={result.total}
        pageSize={PAGE_SIZE}
        offset={offset}
        hrefFor={(next) =>
          `/deliveries?${new URLSearchParams({
            ...(filter !== "all" ? { filter } : {}),
            page: String(Math.floor(next / PAGE_SIZE) + 1),
          })}`
        }
      />
    </>
  );
}
