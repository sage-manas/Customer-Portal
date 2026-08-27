import { z } from "zod";

import { billingMapping } from "../sap-mapping/billing";
import { sapStringSchema } from "../sap-mapping/to-zod";

/**
 * Payments (docs/03-FUNCTIONAL-SPEC.md Screen 7.2, docs/05 §7.7).
 *
 * A payment is the one thing in the O2C chain the portal genuinely owns for
 * a while: between "customer pressed Pay" and "SAP cleared the items" it
 * exists only here, because the gateway has taken money that no FI document
 * yet accounts for. That window is exactly why the portal stores payments
 * when it stores neither orders (ADR-016) nor invoices — losing it would
 * mean losing the record of a real debit against a real customer.
 *
 * The state machine below is deliberately linear and small. Every transition
 * is caused by something external (the gateway's webhook, SAP's posting), so
 * the portal never advances a payment on its own.
 */

// ---- Payment modes (docs/05 §7.7 step 2) --------------------------------

export const PAYMENT_MODES = [
  { code: "upi", label: "UPI", hint: "Instant — you'll be redirected to your UPI app." },
  { code: "netbanking", label: "Net Banking", hint: "Pay from your bank account." },
  { code: "card", label: "Card", hint: "Credit or debit card." },
  {
    code: "neft",
    label: "NEFT / RTGS",
    hint: "Bank transfer — clearing can take up to one working day.",
  },
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number]["code"];

export const PAYMENT_MODE_CODES = PAYMENT_MODES.map((m) => m.code) as readonly PaymentMode[];

export function paymentModeLabel(mode: string): string {
  return PAYMENT_MODES.find((m) => m.code === mode)?.label ?? mode;
}

// ---- Payment lifecycle ---------------------------------------------------

/**
 * Portal-side payment state. It is *not* a `CanonicalStatus`: those describe
 * SAP documents, and a payment is only a SAP document once `posted` (docs/05
 * §6.5 vocabulary is for the O2C documents themselves).
 *
 * `captured` and `posted` are two states rather than one on purpose. The
 * money is taken at `captured`; the FI posting can still fail (SAP down, an
 * item cleared by someone else meanwhile), and a portal that collapsed them
 * would have no way to represent "paid but not yet in SAP" — which is
 * precisely the state doc 05 asks the statement to render as `Pending sync`.
 */
export const PAYMENT_STATUSES = ["initiated", "captured", "posted", "failed", "cancelled"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const NEXT: Record<PaymentStatus, readonly PaymentStatus[]> = {
  initiated: ["captured", "failed", "cancelled"],
  // Capture is terminal for the customer's money: a captured payment is
  // never failed afterwards, only posted (or left for reconciliation).
  captured: ["posted"],
  posted: [],
  failed: [],
  cancelled: [],
};

/** Named for the module because the onboarding workflow has its own. */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return NEXT[from].includes(to);
}

/** Terminal for the customer: nothing they can do will move it on. */
export function isPaymentSettled(status: PaymentStatus): boolean {
  return status === "posted" || status === "failed" || status === "cancelled";
}

/**
 * Money has been taken but SAP hasn't confirmed the clearing yet — the
 * statement's `Pending sync` row and the receipt's "clearing in SAP" note
 * (docs/05 §7.7 return states).
 */
export function isAwaitingSapPosting(status: PaymentStatus): boolean {
  return status === "captured";
}

export interface PaymentAllocation {
  /** BSID-BELNR of the open item this part of the payment settles. */
  documentNumber: string;
  amount: number;
}

export interface Payment {
  id: string;
  kunnr: string;
  amount: number;
  currency: string;
  mode: PaymentMode;
  status: PaymentStatus;
  /** BSEG-KIDNO — the gateway's reference, and the idempotency key. */
  gatewayReference?: string;
  /** FI document created by the F-28 equivalent posting, once posted. */
  fiDocumentNumber?: string;
  /** Items fully cleared by the posting. */
  clearedItems: string[];
  /** Items left partly open — a residual, per docs/02 §6. */
  residualItems: string[];
  /** Customer-facing reason, set on failure (docs/05 §11 vocabulary). */
  failureReason?: string;
  allocations: PaymentAllocation[];
  createdAt: Date;
  updatedAt: Date;
}

// ---- Write schemas -------------------------------------------------------

/**
 * One selected open item. Both constraints come from the billing registry —
 * the BELNR length and the non-negative CURR — with the one tightening the
 * screen adds: paying zero against an item is not an allocation, it is an
 * item the customer didn't select (CLAUDE.md rule 3).
 */
export const paymentAllocationSchema = z.object({
  documentNumber: sapStringSchema(billingMapping, "payDocumentNumber", { required: true }),
  amount: z.coerce.number().positive("Enter an amount greater than zero"),
});

export const paymentInitiateSchema = z
  .object({
    mode: z.enum(PAYMENT_MODE_CODES as [PaymentMode, ...PaymentMode[]], {
      errorMap: () => ({ message: "Choose how you'd like to pay" }),
    }),
    allocations: z.array(paymentAllocationSchema).min(1, "Select at least one invoice to pay"),
  })
  .superRefine((value, ctx) => {
    // The same invoice twice would post two clearings against one item and
    // is always a client bug — SAP would reject the second one anyway.
    const seen = new Set<string>();
    value.allocations.forEach((allocation, index) => {
      if (seen.has(allocation.documentNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allocations", index, "documentNumber"],
          message: "This invoice is selected more than once",
        });
      }
      seen.add(allocation.documentNumber);
    });
  });

export type PaymentInitiateInput = z.infer<typeof paymentInitiateSchema>;

/** Total the customer is about to be charged. */
export function allocationTotal(allocations: readonly PaymentAllocation[]): number {
  return Math.round(allocations.reduce((sum, a) => sum + a.amount, 0) * 100) / 100;
}

export type PaymentAllocationIssueCode =
  /** The item isn't open, isn't the customer's, or doesn't exist. */
  | "not_payable"
  /** More than the item's outstanding balance. */
  | "exceeds_open_amount";

export interface PaymentAllocationIssue {
  documentNumber: string;
  code: PaymentAllocationIssueCode;
  message: string;
}

/**
 * Checks allocations against the open items SAP actually returned.
 *
 * Overpayment is refused rather than posted as an on-account credit: SAP
 * would accept it, but a customer who typed an extra digit is better served
 * by an error than by a balance they have to ask about. Underpayment is
 * fine — that is a partial payment, and it leaves a residual item.
 */
export function validateAllocations(
  allocations: readonly PaymentAllocation[],
  payableItems: ReadonlyArray<{ documentNumber: string; openAmount: number }>,
): PaymentAllocationIssue[] {
  const byNumber = new Map(payableItems.map((item) => [item.documentNumber, item]));
  const issues: PaymentAllocationIssue[] = [];

  for (const allocation of allocations) {
    const item = byNumber.get(allocation.documentNumber);
    if (!item) {
      issues.push({
        documentNumber: allocation.documentNumber,
        code: "not_payable",
        message: "This invoice is no longer open for payment.",
      });
      continue;
    }
    if (allocation.amount > item.openAmount + 0.005) {
      issues.push({
        documentNumber: allocation.documentNumber,
        code: "exceeds_open_amount",
        message: `You can pay at most ${item.openAmount.toFixed(2)} against this invoice.`,
      });
    }
  }

  return issues;
}
