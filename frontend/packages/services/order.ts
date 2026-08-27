/**
 * Frontend-only stand-in for `@cc/service-order`.
 *
 * Order reads and writes go to the mock SAP driver, which really does create
 * a VBELN, run a credit check and hold a blocked order — so "create an
 * order, watch it appear on the list on credit hold" works end to end in the
 * browser with no database. Drafts are portal-owned and live in the demo
 * store.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-order (SAP writes through the tenant's
 * adapter, drafts in the `OrderDraft` table, outbox events on creation).
 */

import {
  buildO2CTimeline,
  creditBlockedQueue,
  type CanonicalStatus,
  type CreditBlockedOrderRow,
  type CreditInfo,
  type Delivery,
  type Invoice,
  type O2CStage,
  type OrderHeaderInput,
  type OrderLineInput,
  type OrderStatusView,
  type SalesOrderInput,
  type ShipToAddress,
} from "@cc/domain";

import {
  DemoServiceError,
  DEMO_FRESHNESS,
  DEMO_TODAY,
  demoStore,
  demoSyncedAt,
  nextSequence,
  requireDemoKunnr,
} from "./_demo";

import { isSapError, type FreshnessClass, type SapAdapter } from "../sap-mock";

export class OrderError extends DemoServiceError {
  constructor(message: string, code = "order_error", status = 400) {
    super(message, { code, status });
    this.name = "OrderError";
  }
}

export function isOrderError(error: unknown): error is OrderError {
  return error instanceof OrderError;
}

export type OrderErrorCode = string;
export type OrderIssue = { path: string; message: string };

/**
 * Maps a failed order lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundOrUnavailable(error: unknown, vbeln: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toOrderError(error);
  throw new OrderError(`We couldn't find order ${vbeln}.`, "not_found", 404);
}

export function toOrderError(error: unknown): OrderError {
  if (isOrderError(error)) return error;
  return new OrderError(
    "We couldn't reach the order system just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type OrderStatusFilter = "all" | "open" | "creditHold" | "completed";

export interface OrderListResult {
  orders: OrderStatusView[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

/**
 * A credit hold outranks GBSTK: it is the status the customer can actually
 * do something about (doc 05 §7.4). Returns a `CanonicalStatus` because
 * `StatusBadge` takes one — a module never invents its own vocabulary
 * (CLAUDE.md rule 3).
 */
export function displayStatus(order: {
  orderStatus: CanonicalStatus;
  creditStatus: CanonicalStatus;
}): CanonicalStatus {
  return order.creditStatus === "CreditHold" ? "CreditHold" : order.orderStatus;
}

function matchesFilter(order: OrderStatusView, filter: OrderStatusFilter): boolean {
  switch (filter) {
    case "open":
      return order.orderStatus !== "Closed" && order.orderStatus !== "Rejected";
    case "creditHold":
      return order.creditStatus === "CreditHold";
    case "completed":
      return order.orderStatus === "Closed";
    default:
      return true;
  }
}

export async function listOrders(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { filter?: OrderStatusFilter; search?: string; limit?: number; offset?: number } = {},
): Promise<OrderListResult> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getOrders(account).catch((error) => {
    throw toOrderError(error);
  });

  let orders = read.data.items.filter((order) => matchesFilter(order, options.filter ?? "all"));
  const search = options.search?.trim().toLowerCase();
  if (search) {
    orders = orders.filter(
      (order) =>
        order.vbeln.toLowerCase().includes(search) ||
        order.customerPoRef?.toLowerCase().includes(search) ||
        order.lines.some((line) => line.material.toLowerCase().includes(search)),
    );
  }

  orders = orders.sort((a, b) => b.createdOn.localeCompare(a.createdOn));
  const total = orders.length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) orders = orders.slice(offset, offset + options.limit);

  return {
    orders,
    total,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface OrderDetail {
  order: OrderStatusView;
  timeline: O2CStage[];
  deliveries: Delivery[];
  invoices: Invoice[];
  cancellable: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<OrderDetail> {
  const account = requireDemoKunnr(kunnr);

  const read = await adapter.getOrderStatus(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  const order = read.data;

  // Cross-account reads are a 404, never a 403 — confirming a document exists
  // on somebody else's account is itself a leak (CLAUDE.md rule 5).
  if (order.kunnr !== account) {
    throw new OrderError(`We couldn't find order ${vbeln}.`, "not_found", 404);
  }

  const deliveries = await adapter.getDeliveriesForOrder(vbeln).catch(() => ({ data: [] }));
  const invoiceRead = await adapter.getInvoices(account).catch(() => null);
  const invoices = (invoiceRead?.data.items ?? []).filter(
    (invoice) =>
      invoice.reference === vbeln ||
      deliveries.data.some((delivery) => delivery.vbeln === invoice.reference),
  );

  return {
    order,
    timeline: buildO2CTimeline({ order, deliveries: deliveries.data, invoices }),
    deliveries: deliveries.data,
    invoices,
    // Doc 05 §7.4: Cancel is offered only while the order is fully open.
    cancellable: order.orderStatus === "Open" && order.creditStatus !== "CreditHold",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface OrderFormDefaults {
  shipTos: ShipToAddress[];
  paymentTerms?: string;
  credit: CreditInfo | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getOrderFormDefaults(
  adapter: SapAdapter,
  kunnr: string | undefined,
): Promise<OrderFormDefaults> {
  const account = requireDemoKunnr(kunnr);
  const [shipTos, credit, customer] = await Promise.all([
    adapter.getShipToAddresses(account).catch(() => ({ data: [] as ShipToAddress[] })),
    adapter.getCreditInfo(account).catch(() => null),
    adapter.getCustomer(account).catch(() => null),
  ]);

  return {
    shipTos: shipTos.data,
    paymentTerms: customer?.data.paymentTerms,
    credit: credit?.data ?? null,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

// ---------------------------------------------------------------------------
// Availability check (ATP)
// ---------------------------------------------------------------------------

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
  creditBlockExpected: boolean;
  fullyConfirmed: boolean;
}

export async function checkAvailability(
  adapter: SapAdapter,
  kunnr: string | undefined,
  input: SalesOrderInput,
): Promise<AvailabilityResult> {
  const account = requireDemoKunnr(kunnr);
  const simulation = await adapter
    .simulateOrder({
      kunnr: account,
      requestedDeliveryDate: input.requestedDeliveryDate,
      shipTo: input.shipTo,
      customerPoRef: input.customerPoRef,
      paymentTerms: input.paymentTerms,
      lines: input.lines,
    })
    .catch((error) => {
      throw toOrderError(error);
    });

  return {
    lines: simulation.lines,
    netValue: simulation.netValue,
    currency: simulation.currency,
    creditBlockExpected: simulation.creditBlockExpected,
    fullyConfirmed: simulation.lines.every((line) => !line.partial),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  input: SalesOrderInput,
) {
  const account = requireDemoKunnr(kunnr);
  return adapter
    .createSalesOrder({
      kunnr: account,
      requestedDeliveryDate: input.requestedDeliveryDate,
      shipTo: input.shipTo,
      customerPoRef: input.customerPoRef,
      paymentTerms: input.paymentTerms,
      incoterms: input.incoterms,
      deliveryPriority: input.deliveryPriority,
      lines: input.lines,
    })
    .catch((error) => {
      throw toOrderError(error);
    });
}

export async function cancelOrder(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
  reason?: string,
) {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getOrderStatus(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  if (read.data.kunnr !== account) {
    throw new OrderError(`We couldn't find order ${vbeln}.`, "not_found", 404);
  }
  return adapter.cancelSalesOrder(vbeln, reason).catch((error) => {
    throw toOrderError(error);
  });
}

// ---------------------------------------------------------------------------
// Credit release queue (AR desk)
// ---------------------------------------------------------------------------

export interface CreditReleaseQueueResult {
  rows: CreditBlockedOrderRow[];
  blockedValue: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listCreditBlockedOrders(
  adapter: SapAdapter,
): Promise<CreditReleaseQueueResult> {
  const read = await adapter.getCreditBlockedOrders().catch((error) => {
    throw toOrderError(error);
  });

  const rows = creditBlockedQueue(read.data.items, DEMO_TODAY);
  return {
    rows,
    blockedValue: round2(rows.reduce((total, row) => total + row.order.netValue, 0)),
    currency: read.data.items[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function releaseCreditBlock(
  adapter: SapAdapter,
  vbeln: string,
  options: { initiatedBy?: string; note?: string } = {},
) {
  return adapter.releaseCreditBlock({ vbeln, ...options }).catch((error) => {
    throw toOrderError(error);
  });
}

// ---------------------------------------------------------------------------
// Drafts (portal-owned)
// ---------------------------------------------------------------------------

export interface OrderDraft {
  id: string;
  kunnr: string;
  header: Partial<OrderHeaderInput>;
  lines: Array<OrderLineInput & { price?: number }>;
  soNumber?: string;
  updatedAt: Date;
}

const drafts = () => demoStore().orderDrafts as OrderDraft[];

export async function listDrafts(_tenantId: string, kunnr: string | undefined) {
  const account = requireDemoKunnr(kunnr);
  return drafts()
    .filter((draft) => draft.kunnr === account && !draft.soNumber)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function countDrafts(tenantId: string, kunnr: string | undefined): Promise<number> {
  return (await listDrafts(tenantId, kunnr)).length;
}

/** Throws `not_found` rather than returning null — the page catches it. */
export async function getDraft(
  _tenantId: string,
  kunnr: string | undefined,
  id: string,
): Promise<OrderDraft> {
  const account = requireDemoKunnr(kunnr);
  const draft = drafts().find((row) => row.id === id && row.kunnr === account);
  // A draft belonging to another account is a 404, the same answer as one
  // that never existed (CLAUDE.md rule 5).
  if (!draft) throw new OrderError("We couldn't find that draft.", "not_found", 404);
  return draft;
}

export async function saveDraft(
  _tenantId: string,
  kunnr: string | undefined,
  input: {
    id?: string;
    header: Partial<OrderHeaderInput>;
    lines: Array<OrderLineInput & { price?: number }>;
  },
): Promise<OrderDraft> {
  const account = requireDemoKunnr(kunnr);
  const existing = input.id ? drafts().find((draft) => draft.id === input.id) : undefined;
  if (existing) {
    existing.header = input.header;
    existing.lines = input.lines;
    existing.updatedAt = new Date();
    return existing;
  }

  const draft: OrderDraft = {
    id: `order-draft-${nextSequence("order-draft")}`,
    kunnr: account,
    header: input.header,
    lines: input.lines,
    updatedAt: new Date(),
  };
  drafts().push(draft);
  return draft;
}

export async function deleteDraft(_tenantId: string, kunnr: string | undefined, id: string) {
  const account = requireDemoKunnr(kunnr);
  const store = demoStore();
  store.orderDrafts = drafts().filter(
    (draft) => !(draft.id === id && draft.kunnr === account),
  ) as unknown[];
}

export async function markDraftSubmitted(
  _tenantId: string,
  kunnr: string | undefined,
  id: string,
  soNumber: string,
) {
  const account = requireDemoKunnr(kunnr);
  const draft = drafts().find((row) => row.id === id && row.kunnr === account);
  if (draft) {
    draft.soNumber = soNumber;
    draft.updatedAt = new Date();
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
