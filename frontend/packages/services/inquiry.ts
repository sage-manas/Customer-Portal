/**
 * Frontend-only stand-in for `@cc/service-inquiry` (inquiries, quotations
 * and the back-office quotation workbench).
 *
 * The mock SAP driver really does raise an inquiry, auto-quote it after a
 * delay and convert an accepted quotation into an order, so the whole
 * inquiry -> quotation -> order flow is demoable without a backend. Drafts
 * are portal-owned and live in the demo store.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-inquiry.
 */

import { z } from "zod";

import {
  quotationAcceptBlock,
  quotationTax,
  quotationValidity,
  canRequestQuotationRevision,
  daysBetween,
  type Inquiry,
  type InquiryHeaderInput,
  type InquiryLineInput,
  type InvoiceTax,
  type Quotation,
  type QuotationAcceptBlock,
  type QuotationValidity,
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

export class InquiryError extends DemoServiceError {
  constructor(message: string, code = "inquiry_error", status = 400) {
    super(message, { code, status });
    this.name = "InquiryError";
  }
}

export function isInquiryError(error: unknown): error is InquiryError {
  return error instanceof InquiryError;
}

export type InquiryErrorCode = string;
export type InquiryIssue = { path: string; message: string };

export function toInquiryError(error: unknown): InquiryError {
  if (isInquiryError(error)) return error;
  return new InquiryError(
    "We couldn't reach the sales system just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

export interface InquiryContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

export type InquiryFilter = "all" | "awaiting" | "quoted";

export interface InquiryListItem extends Inquiry {
  awaitingQuotation: boolean;
}

export interface InquiryListResult {
  inquiries: InquiryListItem[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listInquiries(
  adapter: SapAdapter,
  context: InquiryContext,
  options: { filter?: InquiryFilter; limit?: number; offset?: number } = {},
): Promise<InquiryListResult> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getInquiries(account).catch((error) => {
    throw toInquiryError(error);
  });

  const rows: InquiryListItem[] = read.data.items.map((inquiry) => ({
    ...inquiry,
    awaitingQuotation: !inquiry.quotation,
  }));

  const filter = options.filter ?? "all";
  let filtered = rows.filter((row) =>
    filter === "awaiting" ? row.awaitingQuotation : filter === "quoted" ? !row.awaitingQuotation : true,
  );

  filtered = filtered.sort((a, b) => b.createdOn.localeCompare(a.createdOn));
  const total = filtered.length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) filtered = filtered.slice(offset, offset + options.limit);

  return {
    inquiries: filtered,
    total,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface InquiryDetail {
  inquiry: Inquiry;
  quotation: Quotation | null;
  awaitingQuotation: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getInquiry(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
): Promise<InquiryDetail> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getInquiry(vbeln).catch((error: unknown) => {
    notFoundInquiryOrUnavailable(error, vbeln);
  });
  const inquiry = read.data;
  if (inquiry.kunnr !== account) throw notFoundInquiry(vbeln);

  const quotation = inquiry.quotation
    ? await adapter
        .getQuotation(inquiry.quotation)
        .then((result) => result.data)
        .catch(() => null)
    : null;

  return {
    inquiry,
    quotation,
    awaitingQuotation: !inquiry.quotation,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function createInquiry(
  adapter: SapAdapter,
  context: InquiryContext,
  input: { requiredDeliveryDate: string; validityDays?: number; notes?: string; lines: InquiryLineInput[] },
): Promise<Inquiry> {
  const account = requireDemoKunnr(context.kunnr);
  return adapter
    .createInquiry({
      kunnr: account,
      requiredDeliveryDate: input.requiredDeliveryDate,
      validityDays: input.validityDays,
      notes: input.notes,
      lines: input.lines.map((line) => ({
        material: line.material,
        quantity: line.quantity,
        uom: line.uom ?? "EA",
      })),
    })
    .catch((error) => {
      throw toInquiryError(error);
    });
}

function notFoundInquiry(vbeln: string): InquiryError {
  return new InquiryError(`We couldn't find inquiry ${vbeln}.`, "not_found", 404);
}

/**
 * Maps a failed inquiry lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundInquiryOrUnavailable(error: unknown, vbeln: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toInquiryError(error);
  throw notFoundInquiry(vbeln);
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export type QuotationFilter = "all" | "open" | "expiring" | "expired" | "converted";

export interface QuotationView {
  quotation: Quotation;
  validity: QuotationValidity;
  tax: InvoiceTax;
  acceptBlock: QuotationAcceptBlock | null;
  revisable: boolean;
}

export interface QuotationListResult {
  quotations: QuotationView[];
  total: number;
  /** Expiring-soon count across the whole filtered set, not just this page. */
  expiringCount: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface QuotationDetail extends QuotationView {
  inquiry: Inquiry | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** Derived on every read; nothing about validity is ever stored (ADR-016). */
export function toQuotationView(quotation: Quotation): QuotationView {
  return {
    quotation,
    validity: quotationValidity(quotation.validUntil),
    tax: quotationTax(quotation),
    acceptBlock: quotationAcceptBlock(quotation),
    revisable: canRequestQuotationRevision(quotation),
  };
}

export async function listQuotations(
  adapter: SapAdapter,
  context: InquiryContext,
  options: { filter?: QuotationFilter; limit?: number; offset?: number } = {},
): Promise<QuotationListResult> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getQuotations(account).catch((error) => {
    throw toInquiryError(error);
  });

  const views = read.data.items.map(toQuotationView);
  const filter = options.filter ?? "all";
  let filtered = views.filter((view) => {
    switch (filter) {
      case "open":
        return view.validity.state !== "expired" && !view.quotation.salesOrder;
      case "expiring":
        return view.validity.state === "expiring";
      case "expired":
        return view.validity.state === "expired";
      case "converted":
        return Boolean(view.quotation.salesOrder);
      default:
        return true;
    }
  });

  filtered = filtered.sort((a, b) => b.quotation.createdOn.localeCompare(a.quotation.createdOn));
  const total = filtered.length;
  const expiringCount = filtered.filter(
    (view) => view.acceptBlock === null && view.validity.state === "expiring",
  ).length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) filtered = filtered.slice(offset, offset + options.limit);

  return {
    quotations: filtered,
    total,
    expiringCount,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function getQuotation(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
): Promise<QuotationDetail> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getQuotation(vbeln).catch((error: unknown) => {
    notFoundQuotationOrUnavailable(error, vbeln);
  });
  const quotation = read.data;
  if (quotation.kunnr !== account) throw notFoundQuotation(vbeln);

  const inquiry = quotation.inquiry
    ? await adapter
        .getInquiry(quotation.inquiry)
        .then((result) => result.data)
        .catch(() => null)
    : null;

  return {
    ...toQuotationView(quotation),
    inquiry,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export const acceptQuotationSchema = z.object({
  customerPoRef: z.string().max(35).optional(),
  requestedDeliveryDate: z.string().optional(),
  shipTo: z.string().min(1, "Choose a delivery address"),
});
export type AcceptQuotationInput = z.infer<typeof acceptQuotationSchema>;

export interface AcceptQuotationResult {
  order: Awaited<ReturnType<SapAdapter["convertQuoteToOrder"]>>;
  quotationVbeln: string;
}

export async function acceptQuotation(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
  input: AcceptQuotationInput,
): Promise<AcceptQuotationResult> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getQuotation(vbeln).catch((error: unknown) => {
    notFoundQuotationOrUnavailable(error, vbeln);
  });
  if (read.data.kunnr !== account) throw notFoundQuotation(vbeln);

  // The block is a code, not a sentence — the wording lives here, where the
  // customer reads it (docs/05 §11).
  const block = quotationAcceptBlock(read.data);
  if (block) throw new InquiryError(ACCEPT_BLOCK_MESSAGES[block], block, 409);

  const order = await adapter
    .convertQuoteToOrder({
      quotationVbeln: vbeln,
      customerPoRef: input.customerPoRef,
      requestedDeliveryDate: input.requestedDeliveryDate,
      shipTo: input.shipTo,
    })
    .catch((error) => {
      throw toInquiryError(error);
    });

  return { order, quotationVbeln: vbeln };
}

export const revisionRequestSchema = z.object({
  comment: z.string().min(10, "Tell the sales desk what needs to change").max(1000),
});
export type RevisionRequestInput = z.infer<typeof revisionRequestSchema>;

export async function requestRevision(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
  input: RevisionRequestInput,
): Promise<Quotation> {
  const account = requireDemoKunnr(context.kunnr);
  const read = await adapter.getQuotation(vbeln).catch((error: unknown) => {
    notFoundQuotationOrUnavailable(error, vbeln);
  });
  if (read.data.kunnr !== account) throw notFoundQuotation(vbeln);

  return adapter.requestQuotationRevision(vbeln, input.comment).catch((error) => {
    throw toInquiryError(error);
  });
}

const ACCEPT_BLOCK_MESSAGES: Record<QuotationAcceptBlock, string> = {
  expired: "This quotation has lapsed. Ask the sales desk to revalidate it.",
  converted: "This quotation has already been turned into an order.",
  closed: "This quotation is closed and can no longer be accepted.",
};

function notFoundQuotation(vbeln: string): InquiryError {
  return new InquiryError(`We couldn't find quotation ${vbeln}.`, "not_found", 404);
}

/**
 * Maps a failed quotation lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundQuotationOrUnavailable(error: unknown, vbeln: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toInquiryError(error);
  throw notFoundQuotation(vbeln);
}

// ---------------------------------------------------------------------------
// Back-office workbench
// ---------------------------------------------------------------------------

export interface AgentContext {
  tenantId: string;
  userId?: string;
}

export interface QueuedInquiry extends Inquiry {
  waitingDays: number;
}

export interface InquiryQueueResult {
  inquiries: QueuedInquiry[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listInquiryQueue(
  adapter: SapAdapter,
  _context: AgentContext = { tenantId: "demo-tenant" },
): Promise<InquiryQueueResult> {
  const read = await adapter.getInquiryQueue().catch((error) => {
    throw toInquiryError(error);
  });

  const rows: QueuedInquiry[] = read.data.items.map((inquiry) => ({
    ...inquiry,
    waitingDays: Math.max(0, daysBetween(inquiry.createdOn, DEMO_TODAY)),
  }));

  return {
    inquiries: rows.sort((a, b) => b.waitingDays - a.waitingDays),
    total: rows.length,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function getInquiryForAgent(
  adapter: SapAdapter,
  vbeln: string,
  _context: AgentContext,
): Promise<Inquiry> {
  const read = await adapter.getInquiry(vbeln).catch((error: unknown) => {
    notFoundInquiryOrUnavailable(error, vbeln);
  });
  return read.data;
}

export const issueQuotationSchema = z.object({
  inquiryVbeln: z.string().min(1),
  validUntil: z.string().min(1, "Give the quotation a validity date"),
  lines: z
    .array(z.object({ lineNo: z.coerce.number(), netPrice: z.coerce.number().nonnegative() }))
    .optional(),
});
export type IssueQuotationInput = z.infer<typeof issueQuotationSchema>;

export async function issueQuotation(
  adapter: SapAdapter,
  _context: AgentContext,
  input: IssueQuotationInput,
): Promise<Quotation> {
  return adapter
    .createQuotation({
      inquiryVbeln: input.inquiryVbeln,
      validUntil: input.validUntil,
      lines: input.lines,
    })
    .catch((error) => {
      throw toInquiryError(error);
    });
}

// ---------------------------------------------------------------------------
// Drafts (portal-owned)
// ---------------------------------------------------------------------------

export interface InquiryDraft {
  id: string;
  kunnr: string;
  header: Partial<InquiryHeaderInput>;
  lines: InquiryLineInput[];
  inquiryNumber?: string;
  updatedAt: Date;
}

const drafts = () => demoStore().inquiryDrafts as InquiryDraft[];

export async function listDrafts(_tenantId: string, kunnr: string | undefined) {
  const account = requireDemoKunnr(kunnr);
  return drafts()
    .filter((draft) => draft.kunnr === account && !draft.inquiryNumber)
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
): Promise<InquiryDraft> {
  const account = requireDemoKunnr(kunnr);
  const draft = drafts().find((row) => row.id === id && row.kunnr === account);
  // A draft belonging to another account is a 404, the same answer as one
  // that never existed (CLAUDE.md rule 5).
  if (!draft) throw new InquiryError("We couldn't find that draft.", "not_found", 404);
  return draft;
}

export async function saveDraft(
  _tenantId: string,
  kunnr: string | undefined,
  input: { id?: string; header: Partial<InquiryHeaderInput>; lines: InquiryLineInput[] },
): Promise<InquiryDraft> {
  const account = requireDemoKunnr(kunnr);
  const existing = input.id ? drafts().find((draft) => draft.id === input.id) : undefined;
  if (existing) {
    existing.header = input.header;
    existing.lines = input.lines;
    existing.updatedAt = new Date();
    return existing;
  }

  const draft: InquiryDraft = {
    id: `inquiry-draft-${nextSequence("inquiry-draft")}`,
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
  store.inquiryDrafts = drafts().filter(
    (draft) => !(draft.id === id && draft.kunnr === account),
  ) as unknown[];
}

export async function markDraftSubmitted(
  _tenantId: string,
  kunnr: string | undefined,
  id: string,
  inquiryNumber: string,
) {
  const account = requireDemoKunnr(kunnr);
  const draft = drafts().find((row) => row.id === id && row.kunnr === account);
  if (draft) {
    draft.inquiryNumber = inquiryNumber;
    draft.updatedAt = new Date();
  }
}
