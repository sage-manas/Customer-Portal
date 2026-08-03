import type { Prisma } from "@cc/db";
import { db, runWithTenant } from "@cc/db";
import type { CreditRequestStatus, CreditRequestStatusDef } from "@cc/domain";
import { CREDIT_REQUEST_STATUS_DEFS } from "@cc/domain";

import { LoyaltyError } from "./errors";

/**
 * Row shapes and mapping for the credit-limit request.
 *
 * `Decimal` is the reason this file exists rather than the services returning
 * rows: Prisma hands back `Decimal` objects, which serialise to JSON as an
 * object rather than a number and would reach a screen as `{"s":1,"e":6,...}`.
 * Converting once here means no route handler has to remember.
 */

export const CREDIT_REQUEST_SELECT = {
  id: true,
  customerKunnr: true,
  requestedByUserId: true,
  requestedLimit: true,
  currentLimit: true,
  justification: true,
  state: true,
  approvedLimit: true,
  decisionNote: true,
  decidedByUserId: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CreditLimitRequestSelect;

type CreditRequestRow = Prisma.CreditLimitRequestGetPayload<{
  select: typeof CREDIT_REQUEST_SELECT;
}>;

export interface CreditRequestRecord {
  id: string;
  customerKunnr: string;
  requestedByUserId: string | null;
  requestedLimit: number;
  /** The limit as it stood when the request was raised, not as it stands now. */
  currentLimit: number;
  justification: string;
  status: CreditRequestStatus;
  /** The badge the UI renders — from the registry, never chosen per screen. */
  statusDef: CreditRequestStatusDef;
  approvedLimit: number | null;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCreditRequest(row: CreditRequestRow): CreditRequestRecord {
  const status = row.state as CreditRequestStatus;

  return {
    id: row.id,
    customerKunnr: row.customerKunnr,
    requestedByUserId: row.requestedByUserId,
    requestedLimit: Number(row.requestedLimit),
    currentLimit: Number(row.currentLimit),
    justification: row.justification,
    status,
    statusDef: CREDIT_REQUEST_STATUS_DEFS[status],
    approvedLimit: row.approvedLimit === null ? null : Number(row.approvedLimit),
    decisionNote: row.decisionNote,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Reads one request and enforces the boundary.
 *
 * `kunnr` is undefined for a desk read, which is the *only* way to skip the
 * account check — and callers reach that path through the desk service, never
 * by passing undefined from a request. A customer whose account doesn't match
 * gets `not_found`, identical to a request that never existed (CLAUDE.md rule
 * 5). Same shape as `readOwnedTicket` in @cc/service-support, deliberately.
 */
export async function readOwnedCreditRequest(
  tenantId: string,
  requestId: string,
  options: { kunnr?: string } = {},
): Promise<CreditRequestRecord> {
  const row = await runWithTenant(tenantId, () =>
    db.creditLimitRequest.findUnique({
      where: { id: requestId },
      select: CREDIT_REQUEST_SELECT,
    }),
  );

  if (!row) throw new LoyaltyError("not_found");
  if (options.kunnr !== undefined && row.customerKunnr !== options.kunnr) {
    throw new LoyaltyError("not_found");
  }

  return toCreditRequest(row);
}
