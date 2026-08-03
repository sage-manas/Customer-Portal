import type { FreshnessClass, SapAdapter } from "@cc/adapter-sap";
import { recordEvent, runWithTenant } from "@cc/db";
import type { Inquiry, Quotation } from "@cc/domain";
import { z } from "zod";

import { InquiryError, invalidFrom } from "./errors";
import { toInquiryError } from "./inquiry-service";

/**
 * Quotation workbench, back-office plane (docs/05 §7.3, §8).
 *
 * A separate file from the customer plane for the reason ADR-028 gives about
 * the support module: the wider capability is a *different function*, not a
 * flag on the same one. Nothing here takes a KUNNR, because a sales user
 * legitimately sees every account's inquiries — which is precisely why these
 * entry points must be unreachable from a customer-plane route. They are
 * guarded by `quotation:issue`, and the queue read is its own adapter method
 * (`getInquiryQueue`) rather than an optional argument on the customer's.
 */

export interface AgentContext {
  tenantId: string;
  userId?: string;
}

export interface QueuedInquiry extends Inquiry {
  /** Whole days the inquiry has been waiting — the queue's only sort key. */
  waitingDays: number;
}

export interface InquiryQueueResult {
  inquiries: QueuedInquiry[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inquiries nobody has answered yet, longest-waiting first.
 *
 * The opposite sort to the customer's list, and deliberately so: a customer is
 * checking on their own request, while a sales desk is working a queue and the
 * oldest unanswered inquiry is the one costing the tenant an order.
 */
export async function listInquiryQueue(
  adapter: SapAdapter,
  options: { now?: Date } = {},
): Promise<InquiryQueueResult> {
  const now = options.now ?? new Date();

  const read = await adapter.getInquiryQueue().catch((error: unknown) => {
    throw toInquiryError(error, "the inquiry queue");
  });

  const inquiries = read.data.items
    .map((inquiry) => ({
      ...inquiry,
      waitingDays: Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(`${inquiry.createdOn}T00:00:00.000Z`)) / DAY_MS),
      ),
    }))
    .sort((a, b) => b.waitingDays - a.waitingDays);

  return {
    inquiries,
    total: inquiries.length,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/** One inquiry, as the sales desk sees it — no KUNNR check by design. */
export async function getInquiryForAgent(
  adapter: SapAdapter,
  vbeln: string,
): Promise<{ inquiry: Inquiry; quotation: Quotation | null; freshness: FreshnessClass }> {
  const read = await adapter.getInquiry(vbeln).catch((error: unknown) => {
    throw toInquiryError(error, "inquiry", vbeln);
  });

  const quotation = read.data.quotation
    ? await adapter
        .getQuotation(read.data.quotation)
        .then((q) => q.data)
        .catch(() => null)
    : null;

  return { inquiry: read.data, quotation, freshness: read.freshness };
}

export const issueQuotationSchema = z.object({
  inquiryVbeln: z.string().trim().min(1),
  /** VBAK-BNDDT — how long the tenant is prepared to stand behind the price. */
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Valid-until must be an ISO date (YYYY-MM-DD)"),
  /**
   * Per-line overrides. Omitted lines are priced from the customer's own
   * condition records, which is what VA21 does when nobody intervenes — a
   * workbench that forced a price on every line would make the tenant's
   * pricing procedure decorative.
   */
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().positive(),
        netPrice: z.coerce.number().nonnegative("A quoted price cannot be negative"),
      }),
    )
    .default([]),
});

export type IssueQuotationInput = z.infer<typeof issueQuotationSchema>;

/**
 * Issue a quotation against an inquiry (VA21).
 *
 * SAP first, then the event — the same ordering the customer-plane writes use
 * and for the same reason (ADR-030): the quotation exists in SAP or it does
 * not, and the notification that tells the customer about it is downstream of
 * that fact rather than part of it.
 */
export async function issueQuotation(
  adapter: SapAdapter,
  context: AgentContext,
  input: IssueQuotationInput,
  options: { today?: string } = {},
): Promise<Quotation> {
  const parsed = issueQuotationSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (parsed.data.validUntil < today) {
    throw new InquiryError("invalid", {
      issues: [
        {
          field: "validUntil",
          message: "A quotation can't be issued with a validity date in the past.",
        },
      ],
    });
  }

  const quotation = await adapter
    .createQuotation({
      inquiryVbeln: parsed.data.inquiryVbeln,
      validUntil: parsed.data.validUntil,
      lines: parsed.data.lines,
    })
    .catch((error: unknown) => {
      throw toInquiryError(error, "inquiry", parsed.data.inquiryVbeln);
    });

  try {
    await runWithTenant(context.tenantId, () =>
      recordEvent({
        name: "quotation.issued",
        payload: {
          occurredAt: new Date(),
          kunnr: quotation.kunnr,
          documentNumber: quotation.vbeln,
          inquiry: quotation.inquiry,
          validUntil: quotation.validUntil,
          grossValue: quotation.grossValue,
          currency: quotation.currency,
          issuedByUserId: context.userId,
        },
        dedupeKey: `quotation.issued:${quotation.vbeln}`,
      }),
    );
  } catch {
    // Swallowed for the reason ADR-030 gives: the quotation exists, the
    // customer can see it, and failing the sales user's action over a lost
    // notification would be the worse outcome.
  }

  return quotation;
}
