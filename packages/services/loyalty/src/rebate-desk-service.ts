import type { FreshnessClass, SapAdapter } from "@cc/adapter-sap";
import type { RebateSettlementResult, RebateSettlementRow } from "@cc/domain";
import { rebateSettlementQueue } from "@cc/domain";

import { toLoyaltyError } from "./credit-service";
import { LoyaltyError } from "./errors";

/**
 * The rebate settlement queue, **AP plane** (`/admin/ap`, doc 09 §3.4).
 *
 * A third desk-plane file in this package, on the same pattern as
 * `credit-desk-service.ts`: tenant-wide, no KUNNR to check, its own adapter
 * method (`getRebateRegister()`), reachable only behind `finance:ap`.
 *
 * Read-only, and deliberately. Settling a rebate is VB(7 — it posts a credit
 * memo request against KONA — and the adapter has no method that writes one.
 * A portal button that recorded a settlement SAP had not made would be a
 * second answer to "has this customer been paid?", which is the failure
 * ADR-035 already refuses for credit limits and ADR-059 refuses here.
 */

export interface RebateQueueResult {
  rows: RebateSettlementRow[];
  /** Accrued value of everything SAP has released for settlement. */
  releasedValue: number;
  /** Lapsed agreements nobody has settled — the rows that cost a dispute. */
  overdueCount: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export type RebateQueueFilter = "settleable" | "open" | "all";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every agreement in the tenant, releasable and lapsed ones first.
 *
 * Settled agreements are listed under the `all` filter rather than dropped:
 * "did we settle this one?" is a question the desk asks about a period that
 * has closed, and an answer only obtainable in SAP would send them there for
 * a read the portal already has.
 */
export async function listRebateSettlements(
  adapter: SapAdapter,
  options: { today?: string; filter?: RebateQueueFilter } = {},
): Promise<RebateQueueResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const filter = options.filter ?? "all";

  const read = await adapter.getRebateRegister().catch((error: unknown) => {
    throw toLoyaltyError(error, "the rebate agreements");
  });

  const all = rebateSettlementQueue(read.data, today);
  const rows = all.filter((row) => {
    if (filter === "all") return true;
    if (filter === "settleable") return row.state.settleable;
    return row.state.code !== "D";
  });

  return {
    rows,
    releasedValue: round2(
      all
        .filter((row) => row.state.settleable)
        .reduce((sum, row) => sum + row.agreement.accruedAmount, 0),
    ),
    overdueCount: all.filter((row) => row.overdueForSettlement).length,
    currency: all[0]?.agreement.currency ?? "INR",
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

// ---- Settling one (ADR-059) ---------------------------------------------

/** The idempotency key a given agreement's settlement always carries — derived
 * from the agreement, so a double-clicked Settle is one credit memo request. */
export function rebateSettlementReference(agreementNumber: string): string {
  return `rebate:${agreementNumber}`;
}

/**
 * Settle an agreement SAP has released (VB(7).
 *
 * The register is re-read first and the row must still be settleable, for the
 * reason `payRefund` re-reads its queue: a desk screen is a snapshot, and an
 * agreement settled by the nightly run since it was rendered must not be
 * settled again from a stale button. SAP refuses that anyway — this turns the
 * refusal into a sentence the desk can act on rather than a raw message.
 *
 * Nothing is stored: the credit memo request VB(7 creates is the record, and
 * `initiatedBy` rides onto it so SAP shows who authorised the settlement.
 */
export async function settleRebate(
  adapter: SapAdapter,
  input: { agreementNumber: string; initiatedBy?: string; note?: string },
  options: { today?: string } = {},
): Promise<RebateSettlementResult> {
  const queue = await listRebateSettlements(adapter, options);
  const row = queue.rows.find((r) => r.agreement.agreementNumber === input.agreementNumber);

  if (!row) {
    throw new LoyaltyError("not_found", {
      message: `We couldn't find rebate agreement ${input.agreementNumber}.`,
    });
  }

  if (!row.state.settleable) {
    throw new LoyaltyError("invalid", {
      issues: [
        {
          field: "agreementNumber",
          message:
            row.state.code === "D"
              ? "This agreement has already been settled."
              : "SAP hasn't released this agreement for settlement yet — that happens in VBO2.",
        },
      ],
    });
  }

  return adapter
    .settleRebateAgreement({
      agreementNumber: row.agreement.agreementNumber,
      reference: rebateSettlementReference(row.agreement.agreementNumber),
      initiatedBy: input.initiatedBy,
      note: input.note,
    })
    .catch((error: unknown) => {
      throw toLoyaltyError(error, `rebate agreement ${input.agreementNumber}`);
    });
}
