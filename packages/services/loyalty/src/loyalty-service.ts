import {
  earliestSyncedAt,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type { FiscalYearRange, LoyaltyStanding, RebateAgreement } from "@cc/domain";
import {
  activeRebateAgreements,
  fiscalYearPurchases,
  fiscalYearRange,
  loyaltyStanding,
  totalAccruedRebate,
} from "@cc/domain";

import { isoToday, requireAccount, toLoyaltyError, type CreditContext } from "./credit-service";
import { getTierThresholds } from "./tier-settings";

/**
 * Loyalty & rebates (docs/03 Screen 9.2, docs/05 §7.9).
 *
 * The tier is **computed on every read** from VBRK over the fiscal year and
 * the tenant's thresholds, and stored nowhere. That is ADR-031's reasoning
 * applied to a second derived fact: a stored tier and a threshold the tenant
 * later edits disagree forever, and the stored one wins on the customer's
 * screen while the tenant's own settings page says otherwise. It also means a
 * tier has no moment of change the portal could announce — nothing happens to
 * an account when it crosses a threshold, it simply reads differently the next
 * time, which is why there is no `loyalty.tier.changed` event.
 *
 * The rebate is SAP's number (KONA-KAWRT) and is never recomputed here: the
 * accrual is a settlement figure, and a second answer about money owed to a
 * customer is a second answer.
 */

export interface LoyaltyPosition {
  standing: LoyaltyStanding;
  fiscalYear: FiscalYearRange;
  /** Agreements the customer can still accrue against today. */
  rebates: RebateAgreement[];
  /** Everything KONA holds for the account, including lapsed agreements. */
  allRebates: RebateAgreement[];
  accruedRebate: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

/**
 * The loyalty card and the rebate panel.
 *
 * The billing read is the screen — without it there is no tier — so a failure
 * there fails the call. The rebate read is best-effort for the same reason
 * DSO is on the credit screen: most accounts have no agreement at all, and a
 * KONA read that fails should not cost the customer their tier.
 */
export async function getLoyaltyPosition(
  adapter: SapAdapter,
  context: CreditContext,
  options: { today?: string } = {},
): Promise<LoyaltyPosition> {
  const account = requireAccount(context);
  const today = options.today ?? isoToday();
  const year = fiscalYearRange(today);

  const [invoicesRead, thresholds] = await Promise.all([
    adapter.getInvoices(account).catch((error: unknown) => {
      throw toLoyaltyError(error, "your purchase history");
    }),
    getTierThresholds(context.tenantId),
  ]);

  const rebatesRead = await adapter
    .getRebateAgreements(account)
    .then((read) => read)
    .catch(() => null);

  const invoices = invoicesRead.data.items;
  const ytdValue = fiscalYearPurchases(invoices, year);
  const allRebates = rebatesRead?.data ?? [];
  const reads = rebatesRead ? [invoicesRead, rebatesRead] : [invoicesRead];

  return {
    standing: loyaltyStanding(ytdValue, thresholds),
    fiscalYear: year,
    rebates: activeRebateAgreements(allRebates, today),
    allRebates,
    accruedRebate: totalAccruedRebate(activeRebateAgreements(allRebates, today)),
    currency: invoices.find((invoice) => invoice.currency)?.currency ?? "INR",
    freshness: leastFresh(reads),
    syncedAt: earliestSyncedAt(reads),
  };
}
