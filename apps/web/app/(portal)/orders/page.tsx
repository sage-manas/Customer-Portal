import { hasPermission } from "@cc/domain";
import { displayStatus, listDrafts, listOrders, type OrderStatusFilter } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  Button,
  DocumentNumber,
  Money,
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

import { OrderFilterChips } from "./OrderFilterChips";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Orders list (docs/05 §7.4: "DataTable with status filter chips mirroring
 * dashboard").
 *
 * Rendered on the server from one SAP read, with its freshness on the header
 * — unlike the catalogue grid there is nothing per-row to load lazily, so
 * there is no reason to push this across the client boundary.
 *
 * Drafts sit above the table rather than inside it. A draft is not an order:
 * it has no number, no ATP, no credit check, and mixing the two would let a
 * customer read a row as placed when nothing has been submitted.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly OrderStatusFilter[] = ["all", "open", "creditHold", "completed"];
const PAGE_SIZE = 10;

export default async function OrdersPage({
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

  const canCreate = hasPermission(session, "order:create");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Orders" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no orders to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const read = await safeRead(() =>
    Promise.all([
      listOrders(sap, session.kunnr, { filter, limit: PAGE_SIZE, offset }),
      listDrafts(session.tenantId, session.kunnr),
    ]),
  );

  if (!read.ok) {
    return (
      <>
        <PageHeader
          title="Orders"
          subtitle={`Everything you've placed on account ${session.kunnr}.`}
        />
        <SapUnavailable reason={read.reason} />
      </>
    );
  }

  const [result, drafts] = read.data;

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Orders"
        subtitle={`Everything you've placed on account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/orders/new">New order</Link>
            </Button>
          ) : null
        }
      />

      {drafts.length > 0 ? (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text">
            Drafts
            <span className="ml-2 text-[11.5px] font-normal text-text-dim">
              Not submitted — nothing has reached SAP yet.
            </span>
          </h2>
          <ul className="divide-y divide-border">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="text-[12.5px] font-medium text-text">
                  {draft.header.customerPoRef || "Untitled order"}
                </span>
                <span className="text-[11.5px] text-text-dim">
                  {draft.lines.length} {draft.lines.length === 1 ? "line" : "lines"} · saved{" "}
                  {formatDisplayDate(draft.updatedAt)}
                </span>
                {canCreate ? (
                  <Link
                    href={`/orders/new?draft=${draft.id}`}
                    className="ml-auto text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Resume
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <OrderFilterChips active={filter} />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Order
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Your PO ref
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Placed
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Items
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Value (ex-GST)
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all" ? "No orders yet." : "No orders match this filter right now."}
                  </p>
                  {/* Doc 05 §6.3: an empty state carries its next step. */}
                  <Link
                    href="/catalogue"
                    className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Browse the catalogue
                  </Link>
                </td>
              </tr>
            ) : (
              result.orders.map((order) => (
                <tr key={order.vbeln} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <DocumentNumber value={order.vbeln} href={`/orders/${order.vbeln}`} />
                  </td>
                  <td className="px-4 py-2.5 text-text-mid">{order.customerPoRef ?? "—"}</td>
                  <td className="px-4 py-2.5 text-text-mid">
                    {formatDisplayDate(order.createdOn)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-mid">
                    {order.lines.length}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={order.netValue} />
                  </td>
                  <td className="px-4 py-2.5">
                    {/* A credit hold outranks GBSTK: it is the status the
                        customer can actually do something about. */}
                    <StatusBadge status={displayStatus(order)} />
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
          `/orders?${new URLSearchParams({
            ...(filter !== "all" ? { filter } : {}),
            page: String(Math.floor(next / PAGE_SIZE) + 1),
          })}`
        }
      />
    </>
  );
}
