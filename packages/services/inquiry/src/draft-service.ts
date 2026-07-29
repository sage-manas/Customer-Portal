import { db, getTenantId, runWithTenant } from "@cc/db";
import type { InquiryDraftInput, InquiryHeaderInput, InquiryLineInput } from "@cc/domain";
import { inquiryDraftSchema } from "@cc/domain";

import { InquiryError } from "./errors";

/**
 * Inquiry drafts — "Draft/Submit" on docs/05 §7.3.
 *
 * The only stored part of this module, and stored for exactly the reason the
 * order draft and the cart are: SAP has no concept of it. A draft is a
 * half-filled form with no VBELN, no ATP and no price, and nothing about it is
 * authoritative. Once submitted, SAP owns the inquiry and every read goes
 * there (inquiry-service.ts); the row survives only as the link between the
 * form the customer filled in and the inquiry it became.
 *
 * Keyed to the sold-to account rather than the user (ADR-014): B2B purchasing
 * is a team activity, and a colleague must be able to send what a buyer
 * staged. Tenant scoping is structural — every query runs inside
 * `runWithTenant`, so another tenant's draft is not found rather than
 * forbidden.
 */

export interface InquiryDraft {
  id: string;
  kunnr: string;
  header: Partial<InquiryHeaderInput>;
  lines: InquiryLineInput[];
  /** Set once submitted — the inquiry it became. */
  inquiryNumber?: string;
  updatedAt: Date;
}

interface DraftRow {
  id: string;
  customerKunnr: string;
  inquiryNumber: string | null;
  header: unknown;
  updatedAt: Date;
  lines: Array<{ lineNo: number; material: string; quantity: unknown; uom: string }>;
}

const DRAFT_SELECT = {
  id: true,
  customerKunnr: true,
  inquiryNumber: true,
  header: true,
  updatedAt: true,
  lines: { select: { lineNo: true, material: true, quantity: true, uom: true } },
} as const;

const toNumber = (value: unknown): number => Number(value);

function toDraft(row: DraftRow): InquiryDraft {
  return {
    id: row.id,
    kunnr: row.customerKunnr,
    header: (row.header ?? {}) as Partial<InquiryHeaderInput>,
    lines: row.lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((line) => ({
        material: line.material,
        quantity: toNumber(line.quantity),
        uom: line.uom,
      })),
    inquiryNumber: row.inquiryNumber ?? undefined,
    updatedAt: row.updatedAt,
  };
}

function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new InquiryError("no_account");
  return kunnr;
}

function parseDraft(input: InquiryDraftInput): InquiryDraftInput {
  const parsed = inquiryDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new InquiryError("invalid", {
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
 * diffed, like the order draft's: a draft is a snapshot of a form, and merging
 * two snapshots is how a line the customer deleted comes back.
 */
export async function saveDraft(
  tenantId: string,
  kunnr: string | undefined,
  input: InquiryDraftInput,
  draftId?: string,
): Promise<InquiryDraft> {
  const account = requireKunnr(kunnr);
  const { lines, ...header } = parseDraft(input);

  return runWithTenant(tenantId, async () => {
    const boundTenantId = getTenantId();

    const id = await (async () => {
      if (!draftId) {
        const created = await db.inquiryDraft.create({
          data: { tenantId: boundTenantId, customerKunnr: account, header },
          select: { id: true },
        });
        return created.id;
      }

      // Scoped by account *and* by "not yet submitted": once an inquiry
      // exists in SAP the form behind it is history, not an editable draft.
      const updated = await db.inquiryDraft.updateMany({
        where: { id: draftId, customerKunnr: account, inquiryNumber: null },
        data: { header, updatedAt: new Date() },
      });
      if (updated.count === 0) throw new InquiryError("not_found");
      return draftId;
    })();

    await db.inquiryDraftLine.deleteMany({ where: { draftId: id } });
    if (lines.length > 0) {
      await db.inquiryDraftLine.createMany({
        data: lines.map((line, index) => ({
          tenantId: boundTenantId,
          draftId: id,
          lineNo: (index + 1) * 10,
          material: line.material,
          quantity: line.quantity,
          uom: line.uom,
        })),
      });
    }

    return requireDraftRow(id, account);
  });
}

async function requireDraftRow(id: string, kunnr: string): Promise<InquiryDraft> {
  const row = await db.inquiryDraft.findFirst({
    where: { id, customerKunnr: kunnr },
    select: DRAFT_SELECT,
  });
  if (!row) throw new InquiryError("not_found");
  return toDraft(row);
}

export async function getDraft(
  tenantId: string,
  kunnr: string | undefined,
  draftId: string,
): Promise<InquiryDraft> {
  const account = requireKunnr(kunnr);
  return runWithTenant(tenantId, () => requireDraftRow(draftId, account));
}

export async function listDrafts(
  tenantId: string,
  kunnr: string | undefined,
): Promise<InquiryDraft[]> {
  const account = requireKunnr(kunnr);

  return runWithTenant(tenantId, async () => {
    const rows = await db.inquiryDraft.findMany({
      where: { customerKunnr: account, inquiryNumber: null },
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
    const target = await db.inquiryDraft.findFirst({
      where: { id: draftId, customerKunnr: account, inquiryNumber: null },
      select: { id: true },
    });
    if (!target) throw new InquiryError("not_found");

    await db.inquiryDraftLine.deleteMany({ where: { draftId: target.id } });
    await db.inquiryDraft.deleteMany({ where: { id: target.id } });
  });
}

/**
 * Records that a draft became a SAP inquiry. Called after a successful
 * create, never before: a draft marked submitted for an inquiry that never
 * reached SAP is lost work.
 */
export async function markDraftSubmitted(
  tenantId: string,
  kunnr: string | undefined,
  draftId: string,
  inquiryNumber: string,
): Promise<void> {
  const account = requireKunnr(kunnr);

  await runWithTenant(tenantId, async () => {
    await db.inquiryDraft.updateMany({
      where: { id: draftId, customerKunnr: account, inquiryNumber: null },
      data: { inquiryNumber },
    });
  });
}

/** Draft count for the inquiry list — cheaper than loading every draft. */
export async function countDrafts(tenantId: string, kunnr: string | undefined): Promise<number> {
  if (!kunnr) return 0;
  return runWithTenant(tenantId, () =>
    db.inquiryDraft.count({ where: { customerKunnr: kunnr, inquiryNumber: null } }),
  );
}
