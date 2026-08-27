import { FISCAL_YEAR_START_MONTH } from "@cc/config/constants";
import { z } from "zod";

import type { CanonicalStatus } from "../status";

import type { CreditInfo, RebateAgreement } from "./customer";
import type { Invoice, OpenItem } from "./sales-doc";

/**
 * Loyalty & Credit (docs/03 Module 9, docs/05 §7.9).
 *
 * The module with the least storage in the portal and the most arithmetic.
 * SAP owns every input — KNKK holds the limit and the exposure, VBRK holds
 * what the customer bought, KONA holds the rebate agreement — so ADR-016
 * applies with nothing left over: **no credit position, tier or DSO is ever
 * stored**. All three are comparisons against numbers SAP returned, derived on
 * every read exactly as a quotation's validity is (ADR-031).
 *
 * What *is* stored sits either side of that: the tenant's tier thresholds
 * (a per-tenant override of the registry below) and the customer's request for
 * a bigger limit (a portal-owned approval workflow, because FD32 is not
 * something a customer portal drives).
 *
 * Everything a tier or a credit band depends on is a table in this file, for
 * the reason the support registry gives: a threshold that lives in a component
 * is a threshold the service cannot enforce, and a "> 95%" written in a gauge
 * and again in a warning is one that will one day be 95 in one of them.
 */

// ---- The fiscal year ------------------------------------------------------

/**
 * The Indian fiscal year, April to March (`FISCAL_YEAR_START_MONTH`).
 *
 * Doc 03 Screen 9.2 says YTD, and in India YTD means the fiscal year, not the
 * calendar one — a tier computed on calendar YTD would reset every customer to
 * Bronze on 1 January, three months before their buying year ends.
 */
export interface FiscalYearRange {
  /** Inclusive ISO start date (1 April). */
  start: string;
  /** Inclusive ISO end date (31 March). */
  end: string;
  /** "FY 2026-27" — what the screens print. */
  label: string;
}

export function fiscalYearRange(onIso: string): FiscalYearRange {
  const year = Number(onIso.slice(0, 4));
  const month = Number(onIso.slice(5, 7));
  const startYear = month >= FISCAL_YEAR_START_MONTH ? year : year - 1;

  const start = new Date(Date.UTC(startYear, FISCAL_YEAR_START_MONTH - 1, 1));
  // The day before the *next* year's start, rather than a hardcoded 31st.
  // Computed this way so it stays right if `FISCAL_YEAR_START_MONTH` ever
  // changes to a month whose predecessor is short — or to January, where the
  // fiscal year is the calendar one and the end lands in the same year.
  const end = new Date(Date.UTC(startYear + 1, FISCAL_YEAR_START_MONTH - 1, 0));
  const endYear = end.getUTCFullYear();

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label:
      endYear === startYear
        ? `FY ${startYear}`
        : `FY ${startYear}-${String(endYear % 100).padStart(2, "0")}`,
  };
}

export function isWithinFiscalYear(iso: string, range: FiscalYearRange): boolean {
  const date = iso.slice(0, 10);
  return date >= range.start && date <= range.end;
}

// ---- Loyalty tiers --------------------------------------------------------

/**
 * Doc 03 Screen 9.2 fixes the four names; the thresholds are "tenant-
 * configurable", so what lives here is the *vocabulary* plus a default, and a
 * tenant's own numbers override it row by row (see `resolveTierThresholds`).
 */
export const LOYALTY_TIERS = ["bronze", "silver", "gold", "platinum"] as const;

export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export interface LoyaltyTierDef {
  key: LoyaltyTier;
  label: string;
  /** Position in the ladder, 0 = entry. Thresholds must ascend with it. */
  rank: number;
  /**
   * Fiscal-year purchase value at which the tier is reached, in the tenant's
   * currency. A default, not a policy: a tenant that sells turbines and one
   * that sells fasteners cannot share a number, which is why this is
   * overridable per tenant.
   */
  defaultThreshold: number;
  /** One line for the tier card, so the screen carries no copy. */
  blurb: string;
}

export const LOYALTY_TIER_DEFS: Record<LoyaltyTier, LoyaltyTierDef> = {
  bronze: {
    key: "bronze",
    label: "Bronze",
    rank: 0,
    // Always zero: every account with a login is on the ladder, and a tier
    // nobody starts in would leave new customers with no tier at all.
    defaultThreshold: 0,
    blurb: "Every account starts here.",
  },
  silver: {
    key: "silver",
    label: "Silver",
    rank: 1,
    defaultThreshold: 2_500_000,
    blurb: "Priority quotation turnaround.",
  },
  gold: {
    key: "gold",
    label: "Gold",
    rank: 2,
    defaultThreshold: 10_000_000,
    blurb: "Priority quotations and dedicated account support.",
  },
  platinum: {
    key: "platinum",
    label: "Platinum",
    rank: 3,
    defaultThreshold: 25_000_000,
    blurb: "Top of the ladder — best terms, first allocation on short stock.",
  },
};

export const LOYALTY_TIER_LIST: readonly LoyaltyTierDef[] = LOYALTY_TIERS.map(
  (key) => LOYALTY_TIER_DEFS[key],
);

export function isLoyaltyTier(value: string): value is LoyaltyTier {
  return (LOYALTY_TIERS as readonly string[]).includes(value);
}

export type TierThresholds = Record<LoyaltyTier, number>;

export const DEFAULT_TIER_THRESHOLDS: TierThresholds = Object.fromEntries(
  LOYALTY_TIER_LIST.map((tier) => [tier.key, tier.defaultThreshold]),
) as TierThresholds;

/**
 * A tenant's overrides, as the settings form submits them and as the DB
 * stores them — partial, because a tenant that only moves Gold should not have
 * to restate the other three.
 *
 * The ascending check is the reason this is a schema rather than a cast.
 * Thresholds that cross (Gold below Silver) do not produce an error anywhere
 * later; they produce a customer who is silently on the wrong tier, which is
 * the sort of bug that is discovered by an argument about a rebate.
 */
const thresholdField = (tier: LoyaltyTier) =>
  z.coerce.number().nonnegative(`${LOYALTY_TIER_DEFS[tier].label} threshold cannot be negative`);

/**
 * Written out per tier rather than generated from `LOYALTY_TIERS`, so the
 * `satisfies` below makes a tier added to the registry and forgotten here a
 * compile error. A generated shape would have inferred whatever it was given.
 */
const thresholdShape = {
  bronze: thresholdField("bronze"),
  silver: thresholdField("silver"),
  gold: thresholdField("gold"),
  platinum: thresholdField("platinum"),
} satisfies Record<LoyaltyTier, z.ZodTypeAny>;

export const tierThresholdOverridesSchema = z
  .object(thresholdShape)
  .partial()
  .superRefine((overrides, ctx) => {
    if (overrides.bronze !== undefined && overrides.bronze !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bronze"],
        message: "The entry tier starts at zero — every account is at least Bronze.",
      });
    }

    const merged = { ...DEFAULT_TIER_THRESHOLDS, ...overrides };
    for (let i = 1; i < LOYALTY_TIER_LIST.length; i += 1) {
      const lower = LOYALTY_TIER_LIST[i - 1]!;
      const upper = LOYALTY_TIER_LIST[i]!;
      if (merged[upper.key] <= merged[lower.key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [upper.key],
          message: `${upper.label} must be above ${lower.label} (₹${merged[lower.key].toLocaleString("en-IN")}).`,
        });
      }
    }
  });

export type TierThresholdOverrides = z.infer<typeof tierThresholdOverridesSchema>;

/**
 * The tenant's ladder: the registry's defaults with the tenant's overrides on
 * top. An absent override means "use the default" — the same opt-*out*
 * convention `moduleToggles` uses, so a tenant that has never opened the
 * settings screen still has a complete, sane ladder.
 */
export function resolveTierThresholds(overrides: TierThresholdOverrides = {}): TierThresholds {
  return { ...DEFAULT_TIER_THRESHOLDS, ...overrides, bronze: 0 };
}

export interface LoyaltyStanding {
  tier: LoyaltyTierDef;
  /** The next rung, or null at the top of the ladder. */
  nextTier: LoyaltyTierDef | null;
  /** Fiscal-year purchase value the tier was computed from (VBRK-NETWR). */
  ytdValue: number;
  /** What the next tier costs from here; zero at the top. */
  amountToNextTier: number;
  /** 0-100 across the *current* band, which is what the progress bar fills. */
  progressPercent: number;
  thresholds: TierThresholds;
}

/**
 * Which tier this year's purchases have earned (docs/05 §7.9 tier card with
 * "progress bar to next threshold").
 *
 * Derived, never stored — for ADR-031's reason applied to a different fact: a
 * stored tier and a threshold the tenant later edits disagree forever, and the
 * stored one wins on the customer's screen while the tenant's own settings
 * page says something else.
 */
export function loyaltyStanding(
  ytdValue: number,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS,
): LoyaltyStanding {
  let tier = LOYALTY_TIER_LIST[0]!;
  for (const candidate of LOYALTY_TIER_LIST) {
    if (ytdValue >= thresholds[candidate.key]) tier = candidate;
  }

  const nextTier = LOYALTY_TIER_LIST.find((t) => t.rank === tier.rank + 1) ?? null;
  const floor = thresholds[tier.key];
  const ceiling = nextTier ? thresholds[nextTier.key] : null;

  return {
    tier,
    nextTier,
    ytdValue,
    amountToNextTier: ceiling === null ? 0 : round2(Math.max(0, ceiling - ytdValue)),
    // At the top of the ladder the band has no ceiling, so the bar is full —
    // the alternative is a progress bar that can never complete.
    progressPercent:
      ceiling === null || ceiling <= floor
        ? 100
        : clampPercent(((ytdValue - floor) / (ceiling - floor)) * 100),
    thresholds,
  };
}

/**
 * Fiscal-year purchase value from billing documents (VBRK-NETWR).
 *
 * Credit notes count *against* it, which is the whole reason this is a
 * function rather than a sum in a service: a customer who returned half their
 * order has not bought it, and a tier that ignored G2 documents would promote
 * on business the tenant refunded. Taxable value, not gross — GST is the
 * government's, not the customer's spend.
 */
export function fiscalYearPurchases(invoices: readonly Invoice[], range: FiscalYearRange): number {
  let total = 0;
  for (const invoice of invoices) {
    if (!isWithinFiscalYear(invoice.billingDate, range)) continue;
    // Summed exactly as SAP returned them. A credit note is a VBRK document
    // carrying its own negative amounts, so it reduces the total by being
    // added — the portal does not decide what a G2 does to a customer's
    // spend, for the same reason it does not decide their tax (ADR-018).
    total += invoice.taxableAmount;
  }
  // Floored at zero so a year that is net refunds reads as "nothing bought"
  // rather than as a negative number under the Bronze threshold.
  return round2(Math.max(0, total));
}

// ---- The credit position --------------------------------------------------

/**
 * Docs/05 §7.9: "utilization >80% amber, >95% danger with 'orders may be
 * blocked' warning". The two numbers live here so the gauge, the dashboard KPI
 * and any future warning banner read the same thresholds.
 */
export const CREDIT_UTILIZATION_WARNING = 0.8;
export const CREDIT_UTILIZATION_CRITICAL = 0.95;

/**
 * `blocked` is a band of its own rather than a flag beside one, because it is
 * the only state where the number on the gauge is not the thing that matters:
 * a customer at 40% utilisation with CTLPC set cannot order, and a gauge
 * showing a comfortable green with a separate small "blocked" chip is a screen
 * that misleads at a glance.
 */
export type CreditBand = "healthy" | "warning" | "critical" | "blocked";

export interface CreditPosition {
  kunnr: string;
  creditLimit: number;
  utilized: number;
  /** KLIMK − SKFOR, recomputed here rather than trusted off the read. */
  available: number;
  blocked: boolean;
  band: CreditBand;
  /** 0 when there is no limit to be a fraction of. */
  utilizationRatio: number;
  utilizationPercent: number;
  currency: string;
  /**
   * Days sales outstanding over the trailing window, or null when the account
   * has no billing in it — an account that bought nothing has no DSO, and
   * printing "0 days" would read as "pays instantly".
   */
  dso: number | null;
  /** The window DSO was measured over, so the screen can say "90-day". */
  dsoPeriodDays: number;
  /** What the band means, in the customer's terms (docs/05 §11). */
  message: string;
}

export function creditBand(
  info: Pick<CreditInfo, "creditLimit" | "utilized" | "blocked">,
): CreditBand {
  if (info.blocked) return "blocked";
  const ratio = utilizationRatio(info);
  if (ratio >= CREDIT_UTILIZATION_CRITICAL) return "critical";
  if (ratio >= CREDIT_UTILIZATION_WARNING) return "warning";
  return "healthy";
}

/**
 * A zero limit is *not* full utilisation. An account SAP has no credit master
 * for, or one on prepayment terms, would otherwise render as permanently
 * critical and warn the customer that orders may be blocked when nothing is
 * wrong.
 */
export function utilizationRatio(info: Pick<CreditInfo, "creditLimit" | "utilized">): number {
  if (info.creditLimit <= 0) return 0;
  return info.utilized / info.creditLimit;
}

const BAND_MESSAGES: Record<CreditBand, string> = {
  healthy: "Your account is within its credit limit.",
  warning: "You've used most of your credit limit. New orders may need a release.",
  critical: "You're close to your credit limit — new orders may be blocked until you pay.",
  blocked: "Your account is on credit hold. New orders will be held until it's released.",
};

/** The default DSO window (docs/03 Screen 9.1: "DSO (computed, 90-day)"). */
export const DSO_PERIOD_DAYS = 90;

export function creditPosition(
  info: CreditInfo,
  options: { dso?: number | null; dsoPeriodDays?: number } = {},
): CreditPosition {
  const band = creditBand(info);
  const ratio = utilizationRatio(info);

  return {
    kunnr: info.kunnr,
    creditLimit: info.creditLimit,
    utilized: info.utilized,
    // Derived rather than taken from the read, for the reason the mock driver
    // gives when it derives it too: `available` is the one field on KNKK that
    // is arithmetic, and two sources for it eventually disagree.
    available: round2(info.creditLimit - info.utilized),
    blocked: info.blocked,
    band,
    utilizationRatio: ratio,
    utilizationPercent: Math.round(ratio * 1000) / 10,
    currency: info.currency,
    dso: options.dso ?? null,
    dsoPeriodDays: options.dsoPeriodDays ?? DSO_PERIOD_DAYS,
    message: BAND_MESSAGES[band],
  };
}

/**
 * Days sales outstanding: receivables ÷ credit sales in the window × the
 * window's length (docs/03 Screen 9.1).
 *
 * Returns null when there were no sales in the window rather than zero or
 * infinity. Both of those are numbers a screen would print, and both would be
 * read as a statement about how fast this customer pays — which is precisely
 * what an account with no billing gives no evidence about.
 */
export function computeDso(
  receivables: number,
  creditSalesInPeriod: number,
  periodDays: number = DSO_PERIOD_DAYS,
): number | null {
  if (creditSalesInPeriod <= 0) return null;
  return Math.round((receivables / creditSalesInPeriod) * periodDays);
}

/**
 * DSO from the documents the portal already reads for other screens: the open
 * items give the receivable, the invoices give the credit sales. Composed here
 * so the credit screen and any later dashboard KPI cannot compute it two ways.
 */
export function dsoFromDocuments(
  openItems: readonly OpenItem[],
  invoices: readonly Invoice[],
  options: { today: string; periodDays?: number } = { today: isoToday() },
): number | null {
  const periodDays = options.periodDays ?? DSO_PERIOD_DAYS;
  const from = shiftIsoDays(options.today, -periodDays);

  const receivables = openItems.reduce((sum, item) => sum + Math.max(0, item.openAmount), 0);
  // Gross, and signed as SAP returned it — a credit note reduces the period's
  // billing exactly as it reduces the receivable it was raised against.
  const sales = invoices.reduce(
    (sum, invoice) =>
      invoice.billingDate >= from && invoice.billingDate <= options.today
        ? sum + invoice.grossAmount
        : sum,
    0,
  );

  return computeDso(round2(receivables), round2(sales), periodDays);
}

// ---- Rebates --------------------------------------------------------------

/** Rebate agreements the customer can still accrue against (docs/05 §7.9). */
export function activeRebateAgreements(
  agreements: readonly RebateAgreement[],
  today: string = isoToday(),
): RebateAgreement[] {
  return agreements.filter(
    (agreement) => agreement.validFrom <= today && agreement.validTo >= today,
  );
}

export function totalAccruedRebate(agreements: readonly RebateAgreement[]): number {
  return round2(agreements.reduce((sum, agreement) => sum + agreement.accruedAmount, 0));
}

// ---- Credit-limit increase requests ---------------------------------------

/**
 * Docs/03 Screen 9.1: "Request Credit Limit Increase (workflow)".
 *
 * Portal-owned, and the only stored document in this module. It is a *request*
 * and never an instruction: approving it records a tenant's decision, and the
 * limit itself moves when somebody maintains KNKK-KLIMK in FD32. The portal
 * has no adapter method for that on purpose (ADR-035), so nothing here may be
 * read as evidence that the limit changed.
 */
export const CREDIT_REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;

export type CreditRequestStatus = (typeof CREDIT_REQUEST_STATUSES)[number];

export interface CreditRequestStatusDef {
  key: CreditRequestStatus;
  label: string;
  /** The canonical badge status — this module invents no new vocabulary. */
  status: CanonicalStatus;
  terminal: boolean;
}

export const CREDIT_REQUEST_STATUS_DEFS: Record<CreditRequestStatus, CreditRequestStatusDef> = {
  pending: {
    key: "pending",
    label: "Pending approval",
    status: "PendingApproval",
    terminal: false,
  },
  approved: { key: "approved", label: "Approved", status: "Approved", terminal: true },
  rejected: { key: "rejected", label: "Declined", status: "Rejected", terminal: true },
  withdrawn: { key: "withdrawn", label: "Withdrawn", status: "Closed", terminal: true },
};

export type CreditRequestActor = "customer" | "credit_desk";

export interface CreditRequestTransitionDef {
  from: CreditRequestStatus;
  to: CreditRequestStatus;
  /** Who may make this move — the table records it, as the ticket one does. */
  by: readonly CreditRequestActor[];
  label: string;
}

/**
 * The whole workflow. A customer may withdraw their own ask and nothing else:
 * an approval that a customer could reach is not an approval.
 */
export const CREDIT_REQUEST_TRANSITIONS: readonly CreditRequestTransitionDef[] = [
  { from: "pending", to: "approved", by: ["credit_desk"], label: "Approve" },
  { from: "pending", to: "rejected", by: ["credit_desk"], label: "Decline" },
  { from: "pending", to: "withdrawn", by: ["customer"], label: "Withdraw" },
] as const;

export function creditRequestTransition(
  from: CreditRequestStatus,
  to: CreditRequestStatus,
  actor: CreditRequestActor,
): CreditRequestTransitionDef | undefined {
  return CREDIT_REQUEST_TRANSITIONS.find(
    (t) => t.from === from && t.to === to && t.by.includes(actor),
  );
}

export function canTransitionCreditRequest(
  from: CreditRequestStatus,
  to: CreditRequestStatus,
  actor: CreditRequestActor,
): boolean {
  return creditRequestTransition(from, to, actor) !== undefined;
}

export function availableCreditRequestTransitions(
  from: CreditRequestStatus,
  actor: CreditRequestActor,
): CreditRequestTransitionDef[] {
  return CREDIT_REQUEST_TRANSITIONS.filter((t) => t.from === from && t.by.includes(actor));
}

/**
 * An upper bound on the ask, expressed as a multiple of the current limit.
 *
 * Not a policy about what a tenant may grant — it is a typo guard, in the
 * spirit of the inquiry form's one-year validity cap. A customer meaning
 * ₹50,00,000 who types an extra zero should be corrected by the form, not by a
 * credit manager reading a request for ten times their own exposure.
 */
export const CREDIT_INCREASE_MAX_MULTIPLE = 10;

const requestedLimitField = z.coerce
  .number()
  .positive("Enter the limit you'd like, in rupees")
  // CURR(15) in KNKK — the constraint comes from the registry's field length
  // rather than a number chosen here (see sap-mapping/loyalty.ts).
  .max(999_999_999_999_999, "That's larger than SAP can store as a credit limit");

export const creditIncreaseRequestSchema = z.object({
  requestedLimit: requestedLimitField,
  /**
   * Doc 05 §7.9: "form (requested amount + justification)". Required, and long
   * enough to be one: a credit desk deciding on "need more" is deciding on
   * nothing, and the request comes back as a question either way.
   */
  justification: z
    .string()
    .trim()
    .min(20, "Tell the credit team why — a sentence or two is enough")
    .max(1000, "Keep the justification under 1000 characters"),
});

export type CreditIncreaseRequestInput = z.infer<typeof creditIncreaseRequestSchema>;

export const creditRequestDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  /**
   * What the desk actually agreed to, which need not be what was asked — a
   * counter-offer is the common answer to a credit request, and a workflow
   * with only yes and no forces the desk to decline a request it half agrees
   * with. Absent on a decline.
   */
  approvedLimit: requestedLimitField.optional(),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional(),
});

export type CreditRequestDecisionInput = z.infer<typeof creditRequestDecisionSchema>;

/**
 * Whether this ask makes sense against the account's current position, or the
 * message explaining why it doesn't. Returns the message rather than a boolean
 * for the same reason `quotationAcceptBlock` does: "too big" and "not actually
 * an increase" need different corrections from the customer.
 */
export function creditIncreaseIssue(requestedLimit: number, currentLimit: number): string | null {
  if (requestedLimit <= currentLimit) {
    return `Your limit is already ₹${currentLimit.toLocaleString("en-IN")}. Ask for more than that, or raise a support ticket if something else is wrong.`;
  }
  if (currentLimit > 0 && requestedLimit > currentLimit * CREDIT_INCREASE_MAX_MULTIPLE) {
    return `That's more than ${CREDIT_INCREASE_MAX_MULTIPLE}× your current limit. Check the figure, or talk to your account manager about a larger review.`;
  }
  return null;
}

// ---- Small shared helpers -------------------------------------------------

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
