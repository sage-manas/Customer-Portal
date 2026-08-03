import type { SapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type { CreditIncreaseRequestInput } from "@cc/domain";
import {
  canTransitionCreditRequest,
  creditIncreaseIssue,
  creditIncreaseRequestSchema,
} from "@cc/domain";

import {
  CREDIT_REQUEST_SELECT,
  readOwnedCreditRequest,
  toCreditRequest,
  type CreditRequestRecord,
} from "./credit-request-store";
import { getCreditPosition, requireAccount, type CreditContext } from "./credit-service";
import { invalidFrom, LoyaltyError } from "./errors";

/**
 * Credit-limit increase requests, **customer plane** (docs/03 Screen 9.1,
 * docs/05 §7.9).
 *
 * The only stored document in Module 9. It is portal-owned outright, in the
 * A3 sense rather than the ADR-016 sense: SAP has no concept of "a customer
 * asked for more" — FD32 records a limit, not a conversation about one — so
 * there is nothing to mirror and nothing to defer to.
 *
 * What it is *not* is an instruction. Approving a request records that the
 * tenant's credit desk agreed; KNKK-KLIMK moves when somebody maintains it in
 * SAP, and there is deliberately no adapter method here that writes it
 * (ADR-035). Everything the customer sees about their actual limit still comes
 * from `getCreditInfo` on every read.
 *
 * The desk's half lives in credit-desk-service.ts — a separate file with a
 * separate entry point, per ADR-028: a `role: "customer" | "desk"` parameter
 * on one function would be an authorisation boundary expressed as an argument.
 */

export interface CreditRequestListResult {
  requests: CreditRequestRecord[];
  /** The one still with the desk, if any — what the form checks before opening. */
  pending: CreditRequestRecord | null;
}

/** The account's own history, newest first. */
export async function listCreditRequests(context: CreditContext): Promise<CreditRequestListResult> {
  const account = requireAccount(context);

  const rows = await runWithTenant(context.tenantId, () =>
    db.creditLimitRequest.findMany({
      where: { customerKunnr: account },
      orderBy: { createdAt: "desc" },
      select: CREDIT_REQUEST_SELECT,
    }),
  );

  const requests = rows.map(toCreditRequest);

  return {
    requests,
    pending: requests.find((request) => request.status === "pending") ?? null,
  };
}

export async function getCreditRequest(
  context: CreditContext,
  requestId: string,
): Promise<CreditRequestRecord> {
  return readOwnedCreditRequest(context.tenantId, requestId, { kunnr: requireAccount(context) });
}

/**
 * Raise the request (docs/05 §7.9: "form (requested amount + justification) →
 * approval-tracked request").
 *
 * The current limit is read from SAP rather than taken from the form, for two
 * reasons that point the same way. It is the input to the sanity check — an
 * ask has to be *more* than what the account already has — and a client-
 * supplied "current limit" would let a caller pass a low number to slip a
 * large ask past that check. It is then **stored on the row**, which is the
 * ADR-026 move applied to a different fact: the desk must see the delta as it
 * stood when the customer asked, and re-reading KNKK at decision time would
 * silently rewrite the question every time the limit changed.
 */
export async function requestCreditIncrease(
  adapter: SapAdapter,
  context: CreditContext,
  input: CreditIncreaseRequestInput,
): Promise<CreditRequestRecord> {
  const account = requireAccount(context);

  const parsed = creditIncreaseRequestSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  // One open ask per account. Checked rather than constrained because Postgres
  // wants a partial unique index for "only one row where state = pending" and
  // Prisma's schema language cannot express one. The race it leaves is benign:
  // two simultaneous submissions produce two pending rows, which is a tidiness
  // problem for the desk rather than a hazard — nothing is granted by either.
  const existing = await listCreditRequests(context);
  if (existing.pending) throw new LoyaltyError("already_pending");

  const { position } = await getCreditPosition(adapter, context);

  const issue = creditIncreaseIssue(parsed.data.requestedLimit, position.creditLimit);
  if (issue) {
    throw new LoyaltyError("invalid", {
      message: issue,
      issues: [{ field: "requestedLimit", message: issue }],
    });
  }

  const row = await runWithTenant(context.tenantId, () =>
    db.$transaction(async (tx) => {
      const created = await tx.creditLimitRequest.create({
        data: {
          tenantId: context.tenantId,
          customerKunnr: account,
          requestedByUserId: context.userId,
          requestedLimit: parsed.data.requestedLimit,
          currentLimit: position.creditLimit,
          justification: parsed.data.justification,
        },
        select: CREDIT_REQUEST_SELECT,
      });

      // ADR-023 in its strict form, unlike A4's documents: this row is the
      // portal's own, so there *is* a transaction that makes the fact true and
      // the event belongs inside it.
      await writeOutboxEvent(tx, {
        name: "credit.increase.requested",
        payload: {
          occurredAt: new Date(),
          requestId: created.id,
          kunnr: account,
          requestedLimit: Number(created.requestedLimit),
          currentLimit: Number(created.currentLimit),
          requestedByUserId: context.userId,
        },
        dedupeKey: `credit.increase.requested:${created.id}`,
      });

      return created;
    }),
  );

  return toCreditRequest(row);
}

/**
 * Withdraw a request the customer no longer wants decided.
 *
 * The only transition a customer may make, and the registry is what says so —
 * `canTransitionCreditRequest` is asked rather than the status being compared
 * here, so the table in `@cc/domain` stays the single statement of who may do
 * what (CLAUDE.md rule 3).
 */
export async function withdrawCreditRequest(
  context: CreditContext,
  requestId: string,
): Promise<CreditRequestRecord> {
  const account = requireAccount(context);
  const request = await readOwnedCreditRequest(context.tenantId, requestId, { kunnr: account });

  if (!canTransitionCreditRequest(request.status, "withdrawn", "customer")) {
    throw new LoyaltyError("not_allowed");
  }

  const row = await runWithTenant(context.tenantId, () =>
    db.creditLimitRequest.update({
      where: { id: requestId },
      data: { state: "withdrawn", decidedAt: new Date() },
      select: CREDIT_REQUEST_SELECT,
    }),
  );

  // No event: nobody is waiting to be told that somebody stopped asking. The
  // desk sees it leave the queue, which is the whole of the effect.
  return toCreditRequest(row);
}
