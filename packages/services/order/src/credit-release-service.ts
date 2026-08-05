import type { FreshnessClass, SapAdapter } from "@cc/adapter-sap";
import type { CreditBlockedOrderRow } from "@cc/domain";
import { creditBlockedQueue } from "@cc/domain";

import { toOrderError } from "./order-service";

/**
 * The credit release queue, **AR plane** (`/admin/ar`, doc 09 §3.4 — and
 * doc 05 §8, which has been asking for this screen since A5; the note on
 * `/admin/credit` pointing at "a tenant-wide read the adapter does not have"
 * is what `getCreditBlockedOrders()` now answers).
 *
 * A separate file from `order-service.ts` with no KUNNR anywhere, ADR-032's
 * pattern: the customer's `getOrder` compares the document's account to the
 * session's and 404s on a mismatch, and a desk read that reached the same
 * documents by dropping that argument would make the boundary a convention.
 * Guarded by `credit:release`, which `ar_manager` and `client_admin` hold.
 *
 * **Read-only, permanently.** Releasing a credit block is VKM3 — it re-runs
 * the credit check and reopens the delivery-relevant items — and no adapter
 * method writes VBUK-CMGST. The screen therefore lists what is held and says
 * where it is released, exactly as the credit desk records a limit decision
 * without touching KNKK (ADR-035, ADR-059). A button here that marked an
 * order "released" would let a portal user believe goods were about to ship
 * when SAP was still holding them.
 */

export interface CreditReleaseQueueResult {
  rows: CreditBlockedOrderRow[];
  /** Net value SAP is holding — the number that makes the queue urgent. */
  blockedValue: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Held orders, longest-waiting first. */
export async function listCreditBlockedOrders(
  adapter: SapAdapter,
  options: { today?: string } = {},
): Promise<CreditReleaseQueueResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const read = await adapter.getCreditBlockedOrders().catch((error: unknown) => {
    throw toOrderError(error, "the credit release queue");
  });

  const rows = creditBlockedQueue(read.data.items, today);

  return {
    rows,
    blockedValue: round2(rows.reduce((sum, row) => sum + row.order.netValue, 0)),
    currency: rows[0]?.order.currency ?? "INR",
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}
