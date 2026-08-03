import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type { CreditRequestDecisionInput } from "@cc/domain";
import { canTransitionCreditRequest, creditRequestDecisionSchema } from "@cc/domain";

import {
  CREDIT_REQUEST_SELECT,
  readOwnedCreditRequest,
  toCreditRequest,
  type CreditRequestRecord,
} from "./credit-request-store";
import { invalidFrom, LoyaltyError } from "./errors";

/**
 * The credit desk, **back-office plane** (docs/05 §8, `/admin/credit`).
 *
 * A separate file from credit-request-service.ts with separate entry points,
 * for ADR-028's reason: the desk's read is tenant-wide and has no KUNNR to
 * check, and a `visibility` or `asDesk` flag on the customer's functions would
 * put that difference in an argument any caller could pass. Reaching anything
 * here requires `credit:decide-limit` at the route.
 *
 * The decision is a **record of what the desk agreed**, not a change to the
 * customer's limit. KNKK-KLIMK is maintained in FD32 and nothing in this file
 * writes to SAP (ADR-035) — which is why the screen and the notification both
 * say the new limit takes effect once the credit team applies it, rather than
 * implying the customer can go and order against it.
 */

export interface DeskContext {
  tenantId: string;
  userId?: string;
}

export type CreditQueueFilter = "pending" | "decided" | "all";

export interface CreditQueueResult {
  requests: CreditRequestRecord[];
  counts: Record<CreditQueueFilter, number>;
}

/**
 * The queue: every account's requests across the tenant, oldest first.
 *
 * Oldest first, unlike the customer's own list — a desk is working a backlog,
 * and the request that has waited longest is the one that needs answering. The
 * same split the ticket workbench makes against the customer's ticket list.
 */
export async function listCreditRequestQueue(
  context: DeskContext,
  options: { filter?: CreditQueueFilter } = {},
): Promise<CreditQueueResult> {
  const filter = options.filter ?? "pending";

  const rows = await runWithTenant(context.tenantId, () =>
    db.creditLimitRequest.findMany({
      orderBy: { createdAt: "asc" },
      select: CREDIT_REQUEST_SELECT,
    }),
  );

  const all = rows.map(toCreditRequest);
  const pending = all.filter((request) => request.status === "pending");
  const decided = all.filter((request) => request.status !== "pending");

  return {
    requests: filter === "pending" ? pending : filter === "decided" ? decided : all,
    counts: { pending: pending.length, decided: decided.length, all: all.length },
  };
}

/** One request, with no account check — this plane is tenant-wide by design. */
export async function getCreditRequestForDesk(
  context: DeskContext,
  requestId: string,
): Promise<CreditRequestRecord> {
  return readOwnedCreditRequest(context.tenantId, requestId);
}

/**
 * Approve or decline.
 *
 * `approvedLimit` defaults to what was asked, so the common case is one click,
 * but the desk may agree to less — a counter-offer is the usual answer to a
 * credit request, and a workflow with only yes and no forces a desk that half
 * agrees to decline outright.
 */
export async function decideCreditRequest(
  context: DeskContext,
  requestId: string,
  input: CreditRequestDecisionInput,
): Promise<CreditRequestRecord> {
  const parsed = creditRequestDecisionSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const request = await readOwnedCreditRequest(context.tenantId, requestId);

  if (!canTransitionCreditRequest(request.status, parsed.data.decision, "credit_desk")) {
    throw new LoyaltyError("not_allowed");
  }

  const approvedLimit =
    parsed.data.decision === "approved"
      ? (parsed.data.approvedLimit ?? request.requestedLimit)
      : null;

  const row = await runWithTenant(context.tenantId, () =>
    db.$transaction(async (tx) => {
      // Conditional on the state we read, so two desk users deciding the same
      // request at once produce one decision rather than a last-write-wins
      // overwrite of each other's note. The loser sees `not_allowed`, which is
      // true: by then the request was no longer pending.
      const claimed = await tx.creditLimitRequest.updateMany({
        where: { id: requestId, state: "pending" },
        data: {
          state: parsed.data.decision,
          approvedLimit,
          decisionNote: parsed.data.note,
          decidedByUserId: context.userId,
          decidedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new LoyaltyError("not_allowed");

      const updated = await tx.creditLimitRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: CREDIT_REQUEST_SELECT,
      });

      await writeOutboxEvent(tx, {
        name: "credit.increase.decided",
        payload: {
          occurredAt: new Date(),
          requestId,
          kunnr: request.customerKunnr,
          decision: parsed.data.decision,
          approvedLimit: approvedLimit ?? undefined,
          decidedByUserId: context.userId,
        },
        dedupeKey: `credit.increase.decided:${requestId}`,
      });

      return updated;
    }),
  );

  return toCreditRequest(row);
}
