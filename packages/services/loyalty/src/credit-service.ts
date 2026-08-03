import {
  earliestSyncedAt,
  isSapError,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type { CreditPosition } from "@cc/domain";
import { creditPosition, dsoFromDocuments, DSO_PERIOD_DAYS } from "@cc/domain";

import { LoyaltyError } from "./errors";

/**
 * The credit position (docs/03 Screen 9.1, docs/05 §7.9).
 *
 * ADR-016 with nothing left over: KNKK holds the limit and the exposure, so
 * **nothing here is stored**. Every field on the gauge — limit, utilised,
 * available, block status — is a SAP read, and the two derived numbers
 * (utilisation and DSO) are computed in `@cc/domain` on every call. A stored
 * credit position would be the worst mirror in the portal: it changes with
 * every order the customer places and every payment they make, neither of
 * which the portal observes, and a customer acting on a stale limit finds out
 * when their order is blocked.
 */

export interface CreditContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

export interface CreditPositionResult {
  position: CreditPosition;
  freshness: FreshnessClass;
  syncedAt: string;
}

export function toLoyaltyError(error: unknown, what: string): LoyaltyError {
  if (!isSapError(error)) return new LoyaltyError("upstream_unavailable", { cause: error });

  switch (error.kind) {
    case "not_found":
      return new LoyaltyError("not_found", {
        message: `We couldn't find ${what}.`,
        cause: error,
      });
    default:
      return new LoyaltyError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

export function requireAccount(context: CreditContext): string {
  if (!context.kunnr) throw new LoyaltyError("no_account");
  return context.kunnr;
}

/**
 * The credit card on `/account`.
 *
 * The KNKK read is the screen, so a failure there is the screen's failure. The
 * AR and billing reads behind DSO are best-effort: DSO is context, and losing
 * it should cost the customer one metric rather than their credit position —
 * the same call the invoice list makes about its aging bar.
 */
export async function getCreditPosition(
  adapter: SapAdapter,
  context: CreditContext,
  options: { today?: string; periodDays?: number } = {},
): Promise<CreditPositionResult> {
  return readCreditPosition(adapter, requireAccount(context), options);
}

/**
 * The credit position of an account the *credit desk* is looking at.
 *
 * A separate entry point rather than `getCreditPosition` with a KUNNR from
 * somewhere other than the session, because the two have different boundaries:
 * this one has no session account to compare against, and reaching it requires
 * `credit:decide-limit` at the route. ADR-028's separate-planes rule, and the
 * reason `getTicketForAgent` is its own function.
 */
export async function getCreditPositionForDesk(
  adapter: SapAdapter,
  kunnr: string,
  options: { today?: string; periodDays?: number } = {},
): Promise<CreditPositionResult> {
  return readCreditPosition(adapter, kunnr, options);
}

async function readCreditPosition(
  adapter: SapAdapter,
  account: string,
  options: { today?: string; periodDays?: number },
): Promise<CreditPositionResult> {
  const today = options.today ?? isoToday();
  const periodDays = options.periodDays ?? DSO_PERIOD_DAYS;

  const creditRead = await adapter.getCreditInfo(account).catch((error: unknown) => {
    throw toLoyaltyError(error, "your credit position");
  });

  const [openItems, invoices] = await Promise.all([
    adapter
      .getOpenItems(account)
      .then((read) => read)
      .catch(() => null),
    adapter
      .getInvoices(account)
      .then((read) => read)
      .catch(() => null),
  ]);

  // Both halves are needed for a DSO worth printing: receivables without a run
  // rate, or a run rate without receivables, is not a slower-or-faster answer
  // — it is no answer, and `null` is what the screen renders as "—".
  const dso =
    openItems && invoices
      ? dsoFromDocuments(openItems.data, invoices.data.items, { today, periodDays })
      : null;

  const reads = [creditRead, ...(openItems ? [openItems] : []), ...(invoices ? [invoices] : [])];

  return {
    position: creditPosition(creditRead.data, { dso, dsoPeriodDays: periodDays }),
    freshness: leastFresh(reads),
    syncedAt: earliestSyncedAt(reads),
  };
}

/** Today as an ISO date. Injectable everywhere so tests don't depend on the clock. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
