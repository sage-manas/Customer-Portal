import { db, getTenantId, runWithTenant } from "@cc/db";
import type { OrderHeaderInput, OrderLineInput, SalesOrderDraftInput } from "@cc/domain";
import { salesOrderDraftSchema } from "@cc/domain";

import { OrderError } from "./errors";

/**
 * Order drafts — "Save Draft" on docs/03 Screen 4.1.
 *
 * This is the only stored part of the order module, and it is stored for
 * exactly the reason the cart is: SAP has no concept of it. A draft is a
 * half-filled form, not a document — it has no VBELN, no ATP, no credit
 * check, and nothing about it is authoritative. Once submitted, SAP owns the
 * order and every read goes there (order-service.ts); the draft row is kept
 * only as the link between the form the customer filled in and the sales
 * order it became.
 *
 * Like the cart, a draft belongs to the sold-to account rather than to the
 * user who typed it (ADR-014): B2B purchasing is a team activity, and a
 * colleague with `order:create` must be able to submit what a buyer staged.
 * Tenant scoping is structural — every query runs inside `runWithTenant`, so
 * another tenant's draft is not found rather than forbidden.
 */

export interface OrderDraft {
  id: string;
  kunnr: string;
  header: Partial<OrderHeaderInput>;
  lines: OrderLineInput[];
  /** Set once the draft has been submitted — the sales order it became. */
  soNumber?: string;
  updatedAt: Date;
}

interface DraftRow {
  id: string;
  customerKunnr: string;
  soNumber: string | null;
  header: unknown;
  updatedAt: Date;
  lines: Array<{
    lineNo: number;
    material: string;
    quantity: unknown;
    uom: string;
    price: unknown;
    plant: string | null;
  }>;
}

const DRAFT_STATUS = "Draft";
const SUBMITTED_STATUS = "Submitted";

const toNumber = (value: unknown): number => Number(value);

function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new OrderError("no_account");
  return kunnr;
}

function toDraft(row: DraftRow): OrderDraft {
  return {
    id: row.id,
    kunnr: row.customerKunnr,
    header: (row.header ?? {}) as Partial<OrderHeaderInput>,
    lines: row.lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((line) => ({
        material: line.material,
        quantity: toNumber(line.quantity),
        uom: line.uom,
        price: line.price === null ? undefined : toNumber(line.price),
      })),
    soNumber: row.soNumber ?? undefined,
    updatedAt: row.updatedAt,
  };
}

const DRAFT_SELECT = {
  id: true,
  customerKunnr: true,
  soNumber: true,
  header: true,
  updatedAt: true,
  lines: {
    select: { lineNo: true, material: true, quantity: true, uom: true, price: true, plant: true },
  },
} as const;

function parseDraft(input: SalesOrderDraftInput): SalesOrderDraftInput {
  const parsed = salesOrderDraftSchema.safeParse(input);
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
 * Creates or replaces a draft. Lines are replaced wholesale rather than
 * diffed: a draft is a snapshot of a form, and merging two snapshots of the
 * same form is how a line the customer deleted comes back.
 */
export async function saveDraft(
  tenantId: string,
  kunnr: string | undefined,
  input: SalesOrderDraftInput,
  draftId?: string,
): Promise<OrderDraft> {
  const account = requireKunnr(kunnr);
  const { lines, ...header } = parseDraft(input);

  return runWithTenant(tenantId, async () => {
    const boundTenantId = getTenantId();

    const id = await (async () => {
      if (!draftId) {
        const created = await db.salesOrder.create({
          data: {
            tenantId: boundTenantId,
            customerKunnr: account,
            orderStatus: DRAFT_STATUS,
            creditStatus: DRAFT_STATUS,
            header,
          },
          select: { id: true },
        });
        return created.id;
      }

      // Scoped by account *and* by "still a draft": a submitted order is a
      // SAP document and must not be editable through the draft endpoint.
      const updated = await db.salesOrder.updateMany({
        where: { id: draftId, customerKunnr: account, orderStatus: DRAFT_STATUS },
        data: { header, updatedAt: new Date() },
      });
      if (updated.count === 0) throw new OrderError("not_found");
      return draftId;
    })();

    await db.salesOrderLine.deleteMany({ where: { orderId: id } });
    if (lines.length > 0) {
      await db.salesOrderLine.createMany({
        data: lines.map((line, index) => ({
          tenantId: boundTenantId,
          orderId: id,
          lineNo: (index + 1) * 10,
          material: line.material,
          quantity: line.quantity,
          uom: line.uom,
          price: line.price,
        })),
      });
    }

    return requireDraftRow(id, account);
  });
}

async function requireDraftRow(id: string, kunnr: string): Promise<OrderDraft> {
  const row = await db.salesOrder.findFirst({
    where: { id, customerKunnr: kunnr },
    select: DRAFT_SELECT,
  });
  if (!row) throw new OrderError("not_found");
  return toDraft(row);
}

export async function getDraft(
  tenantId: string,
  kunnr: string | undefined,
  draftId: string,
): Promise<OrderDraft> {
  const account = requireKunnr(kunnr);
  return runWithTenant(tenantId, () => requireDraftRow(draftId, account));
}

export async function listDrafts(
  tenantId: string,
  kunnr: string | undefined,
): Promise<OrderDraft[]> {
  const account = requireKunnr(kunnr);

  return runWithTenant(tenantId, async () => {
    const rows = await db.salesOrder.findMany({
      where: { customerKunnr: account, orderStatus: DRAFT_STATUS },
      orderBy: { updatedAt: "desc" },
      select: DRAFT_SELECT,
    });
    return rows.map(toDraft);
  });
}

export async function deleteDraft(
  tenantId: string,
  kunnr: string | undefined,
  draftId: string,
): Promise<void> {
  const account = requireKunnr(kunnr);

  await runWithTenant(tenantId, async () => {
    const target = await db.salesOrder.findFirst({
      where: { id: draftId, customerKunnr: account, orderStatus: DRAFT_STATUS },
      select: { id: true },
    });
    if (!target) throw new OrderError("not_found");

    await db.salesOrderLine.deleteMany({ where: { orderId: target.id } });
    await db.salesOrder.deleteMany({ where: { id: target.id } });
  });
}

/**
 * Records that a draft became a SAP sales order.
 *
 * The row is kept rather than deleted, and its statuses are the ones SAP
 * returned *at submission* — they are a submission record, not a status
 * cache. Nothing reads them back as the order's current state; that always
 * comes from `getOrder`, which asks SAP (docs/05 P1).
 *
 * Called after a successful create, never before: a draft marked submitted
 * for an order that failed to reach SAP would be lost work.
 */
export async function markDraftSubmitted(
  tenantId: string,
  kunnr: string | undefined,
  draftId: string,
  result: { vbeln: string; orderStatus: string; creditStatus: string },
): Promise<void> {
  const account = requireKunnr(kunnr);

  await runWithTenant(tenantId, async () => {
    await db.salesOrder.updateMany({
      where: { id: draftId, customerKunnr: account, orderStatus: DRAFT_STATUS },
      data: {
        soNumber: result.vbeln,
        orderStatus: SUBMITTED_STATUS,
        creditStatus: result.creditStatus,
      },
    });
  });
}

/** Draft count for the orders list — cheaper than loading every draft. */
export async function countDrafts(tenantId: string, kunnr: string | undefined): Promise<number> {
  if (!kunnr) return 0;
  return runWithTenant(tenantId, () =>
    db.salesOrder.count({ where: { customerKunnr: kunnr, orderStatus: DRAFT_STATUS } }),
  );
}
