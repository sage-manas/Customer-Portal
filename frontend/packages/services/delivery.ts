/**
 * Frontend-only stand-in for `@cc/service-delivery`.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-delivery. POD signatures are written to
 * object storage there (@cc/adapter-storage) and posted to SAP (VLPOD);
 * here the confirmation is kept in the in-memory demo store.
 */

import {
  buildDeliveryStages,
  buildO2CTimeline,
  ewayBillExpected,
  isPodConfirmable,
  podDefaultLines,
  type Delivery,
  type DeliveryStage,
  type Invoice,
  type O2CStage,
  type OrderStatusView,
  type PodLineInput,
} from "@cc/domain";

import {
  DemoServiceError,
  DEMO_FRESHNESS,
  demoStore,
  demoSyncedAt,
  requireDemoKunnr,
} from "./_demo";

import { isSapError, type FreshnessClass, type SapAdapter } from "../sap-mock";

export class DeliveryError extends DemoServiceError {
  constructor(message: string, code = "delivery_error", status = 400) {
    super(message, { code, status });
    this.name = "DeliveryError";
  }
}

export function isDeliveryError(error: unknown): error is DeliveryError {
  return error instanceof DeliveryError;
}

export type DeliveryErrorCode = string;
export type DeliveryIssue = { path: string; message: string };

export function toDeliveryError(error: unknown): DeliveryError {
  if (isDeliveryError(error)) return error;
  return new DeliveryError(
    "We couldn't reach the despatch system just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

export function requireKunnr(kunnr: string | undefined): string {
  return requireDemoKunnr(kunnr);
}

// ---------------------------------------------------------------------------
// POD store (portal-owned, ADR-026)
// ---------------------------------------------------------------------------

export interface PodConfirmationLineRecord {
  lineNo: number;
  material: string;
  dispatchedQty: number;
  receivedQty: number;
}

export interface PodConfirmationRecord {
  id: string;
  deliveryVbeln: string;
  kunnr: string;
  /** ISO date the customer says the goods arrived. */
  receiptDate: Date;
  lines: PodConfirmationLineRecord[];
  /** `clean` when every line matched what was dispatched (ADR-026). */
  outcome: "clean" | "discrepancy";
  discrepancy: boolean;
  notes: string | null;
  signedPodKey: string | null;
  confirmedByUserId: string | null;
  createdAt: Date;
}

const pods = () => demoStore().podConfirmations as PodConfirmationRecord[];

export async function findPodConfirmation(
  _tenantId: string,
  deliveryVbeln: string,
): Promise<PodConfirmationRecord | null> {
  return pods().find((row) => row.deliveryVbeln === deliveryVbeln) ?? null;
}

export async function getPodConfirmation(
  tenantId: string,
  deliveryVbeln: string,
): Promise<PodConfirmationRecord> {
  const record = await findPodConfirmation(tenantId, deliveryVbeln);
  if (!record) throw new DeliveryError("No proof of delivery on record.", "not_found", 404);
  return record;
}

export function podStorageKey(tenantId: string, deliveryVbeln: string): string {
  return `${tenantId}/pod/${deliveryVbeln}.pdf`;
}

export function getDeliveryStorage(): null {
  // TODO(BACKEND): object storage lives in @cc/adapter-storage.
  return null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type DeliveryStatusFilter = "all" | "inTransit" | "delivered" | "awaitingPod";

export interface DeliveryListItem extends Delivery {
  stages: DeliveryStage[];
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

export async function listDeliveries(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { filter?: DeliveryStatusFilter; search?: string; limit?: number; offset?: number } = {},
): Promise<DeliveryListResult> {
  const account = requireKunnr(kunnr);
  const read = await adapter.getDeliveries(account).catch((error) => {
    throw toDeliveryError(error);
  });

  let rows: DeliveryListItem[] = read.data.items.map((delivery) => ({
    ...delivery,
    stages: buildDeliveryStages(delivery),
    awaitingPod: isPodConfirmable(delivery),
  }));

  const filter = options.filter ?? "all";
  rows = rows.filter((row) => {
    switch (filter) {
      case "inTransit":
        return row.status === "InTransit" || row.status === "Open";
      case "delivered":
        return row.status === "Delivered" || row.status === "Closed";
      case "awaitingPod":
        return row.awaitingPod;
      default:
        return true;
    }
  });

  const search = options.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (row) =>
        row.vbeln.toLowerCase().includes(search) ||
        row.salesOrder.toLowerCase().includes(search) ||
        row.trackingNumber?.toLowerCase().includes(search),
    );
  }

  const total = rows.length;
  const awaitingCount = rows.filter((row) => row.awaitingPod).length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) rows = rows.slice(offset, offset + options.limit);

  return {
    deliveries: rows,
    total,
    awaitingCount,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface DeliveryDetail {
  delivery: Delivery;
  stages: DeliveryStage[];
  timeline: O2CStage[];
  order: OrderStatusView | null;
  invoices: Invoice[];
  pod: PodConfirmationRecord | null;
  podConfirmable: boolean;
  ewayBillExpected: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getDelivery(
  adapter: SapAdapter,
  context: { tenantId: string; kunnr: string | undefined },
  vbeln: string,
): Promise<DeliveryDetail> {
  const account = requireKunnr(context.kunnr);
  const tenantId = context.tenantId;

  const read = await adapter.getDelivery(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  const delivery = read.data;
  if (delivery.kunnr !== account) throw notFoundDelivery(vbeln);

  const order = await adapter
    .getOrderStatus(delivery.salesOrder)
    .then((result) => result.data)
    .catch(() => null);

  const invoiceRead = await adapter.getInvoices(account).catch(() => null);
  const invoices = (invoiceRead?.data.items ?? []).filter(
    (invoice) => invoice.reference === vbeln,
  );

  return {
    delivery,
    stages: buildDeliveryStages(delivery),
    timeline: order ? buildO2CTimeline({ order, deliveries: [delivery], invoices }) : [],
    order,
    invoices,
    pod: await findPodConfirmation(tenantId, vbeln),
    podConfirmable: isPodConfirmable(delivery),
    ewayBillExpected: ewayBillExpected(order?.netValue ?? 0),
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface PodFormDefaults {
  delivery: Delivery;
  lines: PodLineInput[];
  order: OrderStatusView | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getPodFormDefaults(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<PodFormDefaults> {
  const account = requireKunnr(kunnr);
  const read = await adapter.getDelivery(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  const delivery = read.data;
  if (delivery.kunnr !== account) throw notFoundDelivery(vbeln);
  if (!isPodConfirmable(delivery)) {
    // `not_allowed` is the module's own code for this, and it is what the
    // POD page catches to send the customer back to the shipment screen.
    throw new DeliveryError(
      "This delivery isn't ready for a receipt confirmation yet.",
      "not_allowed",
      409,
    );
  }

  const order = await adapter
    .getOrderStatus(delivery.salesOrder)
    .then((result) => result.data)
    .catch(() => null);

  return {
    delivery,
    lines: podDefaultLines(delivery.lines),
    order,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export function previewPodDiscrepancy(
  delivery: Pick<Delivery, "lines">,
  lines: readonly PodLineInput[],
): boolean {
  return lines.some((line) => {
    const dispatched = delivery.lines.find((row) => row.lineNo === line.lineNo);
    return dispatched ? dispatched.quantity !== line.receivedQty : false;
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface ConfirmReceiptResult {
  deliveryVbeln: string;
  discrepancy: boolean;
  record: PodConfirmationRecord;
}

export async function confirmReceipt(
  adapter: SapAdapter,
  input: {
    tenantId: string;
    deliveryVbeln: string;
    kunnr: string | undefined;
    receiptDate: string;
    lines: PodLineInput[];
    notes?: string;
    userId?: string;
  },
): Promise<ConfirmReceiptResult> {
  const account = requireKunnr(input.kunnr);
  const read = await adapter.getDelivery(input.deliveryVbeln).catch(() => {
    throw notFoundDelivery(input.deliveryVbeln);
  });
  if (read.data.kunnr !== account) throw notFoundDelivery(input.deliveryVbeln);

  const posted = await adapter
    .confirmPod({
      deliveryVbeln: input.deliveryVbeln,
      receiptDate: input.receiptDate,
      lines: input.lines,
    })
    .catch((error) => {
      throw toDeliveryError(error);
    });

  const record: PodConfirmationRecord = {
    id: `pod-${input.deliveryVbeln}`,
    deliveryVbeln: input.deliveryVbeln,
    kunnr: account,
    receiptDate: new Date(`${input.receiptDate}T00:00:00.000Z`),
    lines: input.lines.map((line) => {
      const dispatched = read.data.lines.find((row) => row.lineNo === line.lineNo);
      return {
        lineNo: line.lineNo,
        material: dispatched?.material ?? "",
        dispatchedQty: dispatched?.quantity ?? line.receivedQty,
        receivedQty: line.receivedQty,
      };
    }),
    outcome: posted.discrepancy ? "discrepancy" : "clean",
    discrepancy: posted.discrepancy,
    notes: input.notes ?? null,
    signedPodKey: null,
    confirmedByUserId: input.userId ?? null,
    createdAt: new Date(),
  };

  const store = demoStore();
  store.podConfirmations = [
    ...pods().filter((row) => row.deliveryVbeln !== input.deliveryVbeln),
    record,
  ];

  return { deliveryVbeln: input.deliveryVbeln, discrepancy: posted.discrepancy, record };
}

export interface UploadSignedPodInput {
  tenantId: string;
  deliveryVbeln: string;
  kunnr: string | undefined;
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export async function uploadSignedPod(input: UploadSignedPodInput): Promise<PodConfirmationRecord> {
  // TODO(BACKEND):
  // The real service streams the signed PDF into object storage
  // (@cc/adapter-storage) and stores its key. Demo mode records the key
  // without a body — there is nowhere to put bytes in the browser tier.
  const record = await getPodConfirmation(input.tenantId, input.deliveryVbeln);
  record.signedPodKey = podStorageKey(input.tenantId, input.deliveryVbeln);
  return record;
}

function notFoundDelivery(vbeln: string): DeliveryError {
  return new DeliveryError(`We couldn't find delivery ${vbeln}.`, "not_found", 404);
}

/**
 * Maps a failed delivery lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundOrUnavailable(error: unknown, vbeln: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toDeliveryError(error);
  throw notFoundDelivery(vbeln);
}
