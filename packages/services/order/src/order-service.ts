import {
  earliestSyncedAt,
  isSapError,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type {
  CanonicalStatus,
  CreditInfo,
  Delivery,
  Invoice,
  O2CStage,
  OrderStatusView,
  SalesOrderInput,
  SalesOrderResult,
  ShipToAddress,
} from "@cc/domain";
import {
  buildO2CTimeline,
  isOrderCancellable,
  salesOrderWriteSchema,
  toCreateSalesOrderInput,
} from "@cc/domain";

import { OrderError } from "./errors";

/**
 * Sales Order Management (docs/03 Module 4, docs/05 §7.4).
 *
 * SAP owns sales orders, so — unlike the cart — nothing here is stored:
 * every read composes `SapAdapter` calls and carries their freshness
 * (ADR-007). The portal's only persistence in this module is the draft
 * (draft-service.ts), which is a form the customer hasn't submitted yet and
 * therefore has no SAP counterpart.
 *
 * Two rules run through every function:
 *
 * 1. **The sold-to account is the boundary.** Every entry point takes the
 *    session's KUNNR and compares it to the document's own. A mismatch is a
 *    404, never a 403 — the portal must not confirm that another customer's
 *    order exists (CLAUDE.md rule 5). SAP's own reads are keyed by VBELN
 *    alone, so this check is the control, not a convenience.
 * 2. **The credit gate is surfaced, never worked around.** A blocked order
 *    is a real, created order that the credit team must release (docs/03
 *    Module 4 flow); the portal reports it prominently and does not retry,
 *    hide, or re-submit it.
 */

export interface OrderListResult {
  orders: OrderStatusView[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface OrderDetail {
  order: OrderStatusView;
  /** The O2C spine for this order (docs/05 P4), built in @cc/domain. */
  timeline: O2CStage[];
  deliveries: Delivery[];
  invoices: Invoice[];
  /** Doc 05 §7.4: Cancel is offered only while GBSTK=A. */
  cancellable: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** What the create-order form needs before the customer types anything. */
export interface OrderFormDefaults {
  shipTos: ShipToAddress[];
  /** KNVV-ZTERM — the customer's agreed terms, pre-filled on the form. */
  paymentTerms?: string;
  credit: CreditInfo | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** Per-line ATP outcome, as the sticky footer renders it (docs/05 §7.4). */
export interface AvailabilityLine {
  lineNo: number;
  material: string;
  requestedQty: number;
  confirmedQty: number;
  confirmedDate: string;
  partial: boolean;
}

export interface AvailabilityResult {
  lines: AvailabilityLine[];
  netValue: number;
  currency: string;
  /**
   * True when SAP's credit run says this order would be blocked. It is a
   * warning, not a block: the customer may still submit — the order is
   * created and held, which is what SAP itself does.
   */
  creditBlockExpected: boolean;
  /** Every line confirmed in full on the requested date. */
  fullyConfirmed: boolean;
}

/** Translates a SAP error into the customer-facing order error. */
export function toOrderError(error: unknown, what: string, id?: string): OrderError {
  if (!isSapError(error)) return new OrderError("upstream_unavailable", { cause: error });

  switch (error.kind) {
    case "not_found":
      return new OrderError("not_found", {
        message: `We couldn't find ${what}${id ? ` ${id}` : ""}.`,
        cause: error,
      });
    case "validation":
      // SAP rejecting the order itself (MOQ, ship-to, no condition record) is
      // a business answer, not an outage: surface it against its field.
      return new OrderError("rejected", {
        issues: error.field ? [{ field: error.field, message: error.message }] : [],
        message: error.message,
        upstreamMessage: error.sapMessage,
        cause: error,
      });
    default:
      return new OrderError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new OrderError("no_account");
  return kunnr;
}

/**
 * Doc 05 §7.4 filter chips. `open` is the customer's own vocabulary — it
 * means "still in flight", which includes an order stuck at the credit gate.
 */
export type OrderStatusFilter = "all" | "open" | "creditHold" | "completed";

function matchesFilter(order: OrderStatusView, filter: OrderStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "creditHold":
      return order.creditStatus === "CreditHold";
    case "completed":
      return order.orderStatus === "Closed";
    case "open":
      return order.orderStatus !== "Closed";
  }
}

export async function listOrders(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { filter?: OrderStatusFilter } = {},
): Promise<OrderListResult> {
  const account = requireKunnr(kunnr);

  const read = await adapter.getOrders(account).catch((error: unknown) => {
    throw toOrderError(error, "your orders");
  });

  const orders = read.data.items.filter((order) => matchesFilter(order, options.filter ?? "all"));

  return {
    orders,
    // The total is the filtered count: it drives the list's own "n orders"
    // line, and reporting the unfiltered total there would be a lie.
    total: orders.length,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * One order with everything the detail screen renders: the order itself, the
 * documents downstream of it, and the O2C timeline composed from both.
 *
 * Deliveries and invoices are best-effort — a billing read that fails must
 * not take down the order screen, because the order is the thing the
 * customer came for. The timeline then simply shows those stages as not yet
 * reached, which is also what it shows when they genuinely haven't been.
 */
export async function getOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<OrderDetail> {
  const account = requireKunnr(kunnr);

  const orderRead = await adapter.getOrderStatus(vbeln).catch((error: unknown) => {
    throw toOrderError(error, "order", vbeln);
  });
  const order = orderRead.data;

  // SAP reads by VBELN alone, so this is where cross-customer access is
  // stopped — and it 404s rather than 403s so the answer is identical to
  // that for an order number that never existed.
  if (order.kunnr !== account) throw new OrderError("not_found");

  const [deliveries, invoices] = await Promise.all([
    adapter
      .getDeliveriesForOrder(vbeln)
      .then((read) => read.data)
      .catch(() => [] as Delivery[]),
    adapter
      .getInvoices(account)
      .then((read) => read.data.items)
      .catch(() => [] as Invoice[]),
  ]);

  const related = relatedInvoices(invoices, order, deliveries);

  return {
    order,
    timeline: buildO2CTimeline({ order, deliveries, invoices: related }),
    deliveries,
    invoices: related,
    cancellable: isOrderCancellable(order),
    freshness: orderRead.freshness,
    syncedAt: orderRead.syncedAt,
  };
}

/**
 * VBRP-VGBEL points at the *preceding* document, which for a normal
 * order-to-delivery-to-billing chain is the delivery rather than the order.
 * Matching both keeps order-related billing visible whether the tenant bills
 * against deliveries or against orders directly.
 */
function relatedInvoices(
  invoices: readonly Invoice[],
  order: OrderStatusView,
  deliveries: readonly Delivery[],
): Invoice[] {
  const references = new Set<string>([order.vbeln, ...deliveries.map((d) => d.vbeln)]);
  return invoices.filter((invoice) => invoice.reference && references.has(invoice.reference));
}

export async function getOrderFormDefaults(
  adapter: SapAdapter,
  kunnr: string | undefined,
): Promise<OrderFormDefaults> {
  const account = requireKunnr(kunnr);

  const [shipToRead, customerRead] = await Promise.all([
    adapter.getShipToAddresses(account).catch((error: unknown) => {
      throw toOrderError(error, "your delivery addresses");
    }),
    adapter.getCustomer(account).catch((error: unknown) => {
      throw toOrderError(error, "your account", account);
    }),
  ]);

  // The credit position is context, not a gate: a customer with no credit
  // master can still order, so a failed read leaves the panel out rather
  // than blocking the form.
  const creditRead = await adapter.getCreditInfo(account).catch(() => null);

  const reads = [shipToRead, customerRead, ...(creditRead ? [creditRead] : [])];

  return {
    shipTos: shipToRead.data,
    paymentTerms: customerRead.data.paymentTerms,
    credit: creditRead?.data ?? null,
    freshness: leastFresh(reads),
    syncedAt: earliestSyncedAt(reads),
  };
}

function parseOrder(input: SalesOrderInput): SalesOrderInput {
  const parsed = salesOrderWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw new OrderError("invalid", {
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

/**
 * "Check Availability (ATP)" (docs/05 §7.4 sticky footer) —
 * BAPI_SALESORDER_CREATEFROMDAT2 in SIMULATE mode. It writes nothing: the
 * customer sees the confirmed quantities and dates SAP would give them
 * *before* committing, which is the whole point of the button.
 */
export async function checkAvailability(
  adapter: SapAdapter,
  kunnr: string | undefined,
  input: SalesOrderInput,
): Promise<AvailabilityResult> {
  const account = requireKunnr(kunnr);
  const order = parseOrder(input);

  const simulation = await adapter
    .simulateOrder(toCreateSalesOrderInput(account, order))
    .catch((error: unknown) => {
      throw toOrderError(error, "availability for this order");
    });

  return {
    lines: simulation.lines,
    netValue: simulation.netValue,
    currency: simulation.currency,
    creditBlockExpected: simulation.creditBlockExpected,
    fullyConfirmed: simulation.lines.every((line) => !line.partial),
  };
}

/**
 * Submit (VA01 / BAPI_SALESORDER_CREATEFROMDAT2).
 *
 * The customer PO reference doubles as the idempotency key (docs/03 Screen
 * 4.1, docs/02 §4.3): re-submitting the same PO returns the order already
 * created rather than a second one. A double-clicked Submit therefore costs
 * nothing, and neither does a retry after a timeout.
 *
 * A credit block does *not* fail this call. SAP creates the order and holds
 * it; so does the portal, and the caller renders the hold.
 */
export async function createOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  input: SalesOrderInput,
): Promise<SalesOrderResult> {
  const account = requireKunnr(kunnr);
  const order = parseOrder(input);

  return adapter
    .createSalesOrder(toCreateSalesOrderInput(account, order))
    .catch((error: unknown) => {
      throw toOrderError(error, "this order");
    });
}

/**
 * Cancel (docs/05 §7.4: "only while GBSTK=A"). The status is re-read from
 * SAP rather than trusted from the caller — the screen the button was
 * clicked on may be minutes old, and by now a delivery may exist.
 */
export async function cancelOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
  reason?: string,
): Promise<SalesOrderResult> {
  const account = requireKunnr(kunnr);

  const read = await adapter.getOrderStatus(vbeln).catch((error: unknown) => {
    throw toOrderError(error, "order", vbeln);
  });
  if (read.data.kunnr !== account) throw new OrderError("not_found");
  if (!isOrderCancellable(read.data)) throw new OrderError("not_allowed");

  return adapter.cancelSalesOrder(vbeln, reason).catch((error: unknown) => {
    throw toOrderError(error, "order", vbeln);
  });
}

/** Status the list and the badge should show: a credit hold outranks GBSTK. */
export function displayStatus(order: {
  orderStatus: CanonicalStatus;
  creditStatus: CanonicalStatus;
}): CanonicalStatus {
  return order.creditStatus === "CreditHold" ? "CreditHold" : order.orderStatus;
}
