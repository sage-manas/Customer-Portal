import { db, getTenantId, runWithTenant } from "@cc/db";

/**
 * The portal's half of the proof of delivery (ADR-026).
 *
 * ADR-016 is not being bent here. The delivery, its status and the received
 * quantities all live in SAP and are read from there — what these rows hold
 * is the material SAP has nowhere to put: the customer's discrepancy notes,
 * the signed-POD upload, who pressed the button, and the dispatched
 * quantities as they stood at signing time (SAP's own LIPS-LFIMG is
 * overwritten by VLPOD, so the evidence would otherwise stop showing what
 * the discrepancy actually was).
 *
 * Tenant scoping is structural — every query runs inside `runWithTenant`, so
 * another tenant's POD is not found rather than forbidden.
 */

export interface PodConfirmationLineRecord {
  lineNo: number;
  material: string;
  dispatchedQty: number;
  receivedQty: number;
}

export interface PodConfirmationRecord {
  id: string;
  deliveryVbeln: string;
  salesOrder: string;
  kunnr: string;
  outcome: "confirmed" | "discrepancy";
  receiptDate: Date;
  notes?: string;
  signedPodKey?: string;
  confirmedByUserId?: string;
  createdAt: Date;
  lines: PodConfirmationLineRecord[];
}

const toNumber = (value: unknown): number => Number(value);

interface PodRow {
  id: string;
  deliveryVbeln: string;
  salesOrder: string;
  customerKunnr: string;
  outcome: "confirmed" | "discrepancy";
  receiptDate: Date;
  notes: string | null;
  signedPodKey: string | null;
  confirmedByUserId: string | null;
  createdAt: Date;
  lines: Array<{
    lineNo: number;
    material: string;
    dispatchedQty: unknown;
    receivedQty: unknown;
  }>;
}

const POD_SELECT = {
  id: true,
  deliveryVbeln: true,
  salesOrder: true,
  customerKunnr: true,
  outcome: true,
  receiptDate: true,
  notes: true,
  signedPodKey: true,
  confirmedByUserId: true,
  createdAt: true,
  lines: {
    select: { lineNo: true, material: true, dispatchedQty: true, receivedQty: true },
  },
} as const;

function toRecord(row: PodRow): PodConfirmationRecord {
  return {
    id: row.id,
    deliveryVbeln: row.deliveryVbeln,
    salesOrder: row.salesOrder,
    kunnr: row.customerKunnr,
    outcome: row.outcome,
    receiptDate: row.receiptDate,
    notes: row.notes ?? undefined,
    signedPodKey: row.signedPodKey ?? undefined,
    confirmedByUserId: row.confirmedByUserId ?? undefined,
    createdAt: row.createdAt,
    lines: row.lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((line) => ({
        lineNo: line.lineNo,
        material: line.material,
        dispatchedQty: toNumber(line.dispatchedQty),
        receivedQty: toNumber(line.receivedQty),
      })),
  };
}

/**
 * The stored POD for one delivery, if the portal recorded one.
 *
 * The KUNNR is filtered on as well as the delivery number. That is belt and
 * braces — the caller has already checked ownership against LIKP-KUNAG — but
 * it costs nothing and means a future caller that forgets still cannot read
 * another customer's notes.
 */
export async function findPodConfirmation(
  tenantId: string,
  kunnr: string,
  deliveryVbeln: string,
): Promise<PodConfirmationRecord | null> {
  return runWithTenant(tenantId, async () => {
    const row = await db.podConfirmation.findFirst({
      where: { deliveryVbeln, customerKunnr: kunnr },
      select: POD_SELECT,
    });
    return row ? toRecord(row as PodRow) : null;
  });
}

/** The same read for a caller that already has a tenant context bound. */
export async function getPodConfirmation(
  kunnr: string,
  deliveryVbeln: string,
): Promise<PodConfirmationRecord | null> {
  // Throws if nothing is bound, which is the point — a POD read with no
  // tenant context must not silently query across tenants.
  getTenantId();

  const row = await db.podConfirmation.findFirst({
    where: { deliveryVbeln, customerKunnr: kunnr },
    select: POD_SELECT,
  });
  return row ? toRecord(row as PodRow) : null;
}

export { POD_SELECT, toRecord, type PodRow };
