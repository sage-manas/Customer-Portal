import { isSapError, type FreshnessClass, type SapAdapter } from "@cc/adapter-sap";
import type {
  Delivery,
  DeliveryStage,
  Invoice,
  O2CStage,
  OrderStatusView,
  PodDiscrepancy,
} from "@cc/domain";
import {
  buildDeliveryStages,
  buildO2CTimeline,
  deliveryStageIndex,
  ewayBillExpected,
  isPodConfirmable,
  page,
  podDefaultLines,
  podDiscrepancy,
} from "@cc/domain";

import { DeliveryError } from "./errors";
import { findPodConfirmation, type PodConfirmationRecord } from "./pod-store";

/**
 * Delivery & Tracking (docs/03 Module 5, docs/05 §7.5).
 *
 * SAP owns delivery documents, so — exactly like sales orders and invoices
 * (ADR-016) — **nothing about a shipment is stored**. Every read composes
 * `SapAdapter` calls and carries their freshness. The one thing the portal
 * keeps is the proof-of-delivery evidence, which SAP has nowhere to put
 * (ADR-026); it lives in pod-store.ts and is joined onto the read here.
 *
 * The rule that runs through every function: **the sold-to account is the
 * boundary.** Every entry point takes the session's KUNNR and compares it to
 * `Delivery.kunnr` (LIKP-KUNAG). A mismatch is a 404, never a 403 — SAP reads
 * a delivery by VBELN alone, so this check is the control, not a convenience
 * (CLAUDE.md rule 5, ADR-025).
 */

export type DeliveryStatusFilter = "all" | "inTransit" | "delivered" | "awaitingPod";

export interface DeliveryListItem extends Delivery {
  /** The shipment stepper, derived in @cc/domain and merely rendered. */
  stages: DeliveryStage[];
  /** True while the customer still owes us a signature (docs/05 §7.5). */
  awaitingPod: boolean;
}

export interface DeliveryListResult {
  deliveries: DeliveryListItem[];
  total: number;
  /** Awaiting-POD count across the whole filtered set, not just this page. */
  awaitingCount: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface DeliveryDetail {
  delivery: Delivery;
  stages: DeliveryStage[];
  /** The O2C spine, built in @cc/domain and merely rendered (ADR-015). */
  timeline: O2CStage[];
  /** The order this shipment came from, when it could be read. */
  order: OrderStatusView | null;
  /** Billing raised against this delivery (VBRP-VGBEL), when readable. */
  invoices: Invoice[];
  /** The portal-owned POD record, once the customer has signed (ADR-026). */
  pod: PodConfirmationRecord | null;
  /** Whether the POD screen may be opened at all. */
  podConfirmable: boolean;
  /**
   * Whether an e-way bill should exist for this consignment. Rendered as a
   * gap, not an error: the portal reports what SAP holds and never generates
   * the bill itself (that is Track C).
   */
  ewayBillExpected: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** What the POD screen renders before the customer types anything. */
export interface PodFormDefaults {
  delivery: Delivery;
  /** Pre-filled at the dispatched quantity (docs/05 §7.5). */
  lines: ReturnType<typeof podDefaultLines>;
  order: OrderStatusView | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

export function toDeliveryError(error: unknown, what: string, id?: string): DeliveryError {
  if (!isSapError(error)) return new DeliveryError("upstream_unavailable", { cause: error });

  switch (error.kind) {
    case "not_found":
      return new DeliveryError("not_found", {
        message: `We couldn't find ${what}${id ? ` ${id}` : ""}.`,
        cause: error,
      });
    case "validation":
      // SAP refusing the POD (already confirmed, not despatched) is a
      // business answer about *when*, not a malformed request.
      return new DeliveryError("not_allowed", {
        message: error.message,
        upstreamMessage: error.sapMessage,
        cause: error,
      });
    default:
      return new DeliveryError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

export function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new DeliveryError("no_account");
  return kunnr;
}

/**
 * A shipment the customer has not signed for yet, and could.
 *
 * `podConfirmed` comes from SAP (LIKP-KOQUK) rather than from the portal's
 * own POD rows: a receipt confirmed in VL03N by the sales team is just as
 * real as one confirmed here, and a list that only knew about portal
 * signatures would nag customers about deliveries already closed.
 */
function isAwaitingPod(delivery: Delivery): boolean {
  return isPodConfirmable(delivery);
}

function matchesFilter(delivery: Delivery, filter: DeliveryStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "inTransit":
      return delivery.status === "InTransit";
    case "delivered":
      return delivery.status === "Delivered";
    case "awaitingPod":
      return isAwaitingPod(delivery);
  }
}

function decorate(delivery: Delivery): DeliveryListItem {
  return {
    ...delivery,
    stages: buildDeliveryStages(delivery),
    awaitingPod: isAwaitingPod(delivery),
  };
}

/**
 * The shipment list (docs/05 §7.5).
 *
 * Sorted by how far along each shipment is, least-advanced first, then by
 * dispatch date: the customer opening this screen is asking "where are my
 * goods?", and the ones still moving are the answer. A delivered consignment
 * from last month is history and sinks to the bottom.
 */
export async function listDeliveries(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { filter?: DeliveryStatusFilter; limit?: number; offset?: number } = {},
): Promise<DeliveryListResult> {
  const account = requireKunnr(kunnr);

  const read = await adapter.getDeliveries(account).catch((error: unknown) => {
    throw toDeliveryError(error, "your deliveries");
  });

  const deliveries = read.data.items
    .filter((delivery) => matchesFilter(delivery, options.filter ?? "all"))
    .map(decorate)
    .sort(byProgressThenDate);

  return {
    deliveries: page(deliveries, options),
    // The filtered count, which is what the list's own "n deliveries" line
    // and the pager report — the unfiltered total there would be a lie.
    total: deliveries.length,
    // Counted before paging, for the same reason.
    awaitingCount: deliveries.filter((delivery) => delivery.awaitingPod).length,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

function byProgressThenDate(a: DeliveryListItem, b: DeliveryListItem): number {
  const progress = deliveryStageIndex(a.status) - deliveryStageIndex(b.status);
  if (progress !== 0) return progress;

  const dateA = a.actualGoodsIssue ?? a.plannedGoodsIssue ?? "";
  const dateB = b.actualGoodsIssue ?? b.plannedGoodsIssue ?? "";
  return dateB.localeCompare(dateA);
}

/**
 * Reads one delivery and enforces the ownership boundary.
 *
 * Shared by every entry point that takes a VBELN, so the check cannot be
 * skipped by adding a function — a delivery whose KUNNR doesn't match the
 * session's is indistinguishable from one that never existed.
 */
async function readOwnedDelivery(
  adapter: SapAdapter,
  account: string,
  vbeln: string,
): Promise<{ delivery: Delivery; freshness: FreshnessClass; syncedAt: string }> {
  const read = await adapter.getDelivery(vbeln).catch((error: unknown) => {
    throw toDeliveryError(error, "delivery", vbeln);
  });

  if (read.data.kunnr !== account) throw new DeliveryError("not_found");

  return { delivery: read.data, freshness: read.freshness, syncedAt: read.syncedAt };
}

/**
 * One shipment with everything the tracking screen renders.
 *
 * The order, the billing and the stored POD are all best-effort, for the same
 * reason they are on the order screen: the shipment is what the customer came
 * for, and a failed billing read must not take the page down with it. What is
 * *not* best-effort is the ownership check.
 */
export async function getDelivery(
  adapter: SapAdapter,
  context: { tenantId: string; kunnr: string | undefined },
  vbeln: string,
): Promise<DeliveryDetail> {
  const account = requireKunnr(context.kunnr);
  const { delivery, freshness, syncedAt } = await readOwnedDelivery(adapter, account, vbeln);

  const [order, invoices, pod] = await Promise.all([
    adapter
      .getOrderStatus(delivery.salesOrder)
      .then((read) => read.data)
      .catch(() => null),
    adapter
      .getInvoices(account)
      .then((read) => read.data.items)
      .catch(() => [] as Invoice[]),
    // Best-effort like the rest: the shipment is what the customer came for,
    // and a database blip must not cost them the tracking screen.
    findPodConfirmation(context.tenantId, account, delivery.vbeln).catch(() => null),
  ]);

  const related = invoices.filter((invoice) => invoice.reference === delivery.vbeln);
  const netValue = delivery.lines.reduce((sum, line) => sum + line.netValue, 0);

  return {
    delivery,
    stages: buildDeliveryStages(delivery),
    // Without the originating order there is no chain to draw — the stages
    // are derived from an order, so a delivery we can't trace back to one
    // gets no timeline rather than a fabricated single-stage one.
    timeline: order ? buildO2CTimeline({ order, deliveries: [delivery], invoices: related }) : [],
    order,
    invoices: related,
    pod,
    podConfirmable: isPodConfirmable(delivery),
    ewayBillExpected: ewayBillExpected(netValue),
    freshness,
    syncedAt,
  };
}

/**
 * The POD screen's starting state (docs/05 §7.5: "received-qty per line
 * (LFIMG, pre-filled = dispatched, editable)").
 *
 * Whether the screen may be opened is decided here rather than by the route,
 * so a customer who bookmarks `/deliveries/x/pod` for a shipment still in the
 * warehouse gets the same answer as one who never saw a button.
 */
export async function getPodFormDefaults(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<PodFormDefaults> {
  const account = requireKunnr(kunnr);
  const { delivery, freshness, syncedAt } = await readOwnedDelivery(adapter, account, vbeln);

  if (!isPodConfirmable(delivery)) throw new DeliveryError("not_allowed");

  const order = await adapter
    .getOrderStatus(delivery.salesOrder)
    .then((read) => read.data)
    .catch(() => null);

  return {
    delivery,
    lines: podDefaultLines(delivery.lines),
    order,
    freshness,
    syncedAt,
  };
}

/**
 * What the customer is about to submit, compared against what was dispatched.
 * Exposed so the POD screen can label its own button honestly — Confirm
 * Receipt for a clean receipt, Report Discrepancy when the numbers differ —
 * using the same function the write path uses to decide what actually
 * happened. Two implementations would eventually disagree.
 */
export function previewPodDiscrepancy(
  delivery: Pick<Delivery, "lines">,
  lines: ReadonlyArray<{ lineNo: number; receivedQty: number }>,
): PodDiscrepancy {
  return podDiscrepancy(delivery.lines, lines);
}

export { readOwnedDelivery };
