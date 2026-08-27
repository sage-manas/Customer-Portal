/**
 * Reconciliation & exception queues (docs/07 B4, docs/DECISIONS.md ADR-044).
 *
 * Nothing new is stored for this phase — `Payment` and `OutboxEvent` already
 * carry every fact an exception is made of (ADR-019, ADR-023), and a
 * projection of "things that are wrong" would go stale the moment the
 * underlying row changed, exactly the failure ADR-037 refused for reports.
 * So an exception is derived on every read, the same way a quotation's
 * expiry is (ADR-031): these two functions are the one place "how overdue is
 * too overdue" is decided, and the admin tray and the worker's automatic
 * retry both call them rather than each drifting its own threshold.
 */

export type ReconciliationExceptionKind =
  "payment_posting_overdue" | "payment_capture_unconfirmed" | "outbox_event_failed";

export type ReconciliationSeverity = "warning" | "critical";

export interface ReconciliationExceptionRule {
  kind: ReconciliationExceptionKind;
  label: string;
  /** How long the underlying fact may sit before it counts as stuck rather than merely in flight. */
  staleAfterMs: number;
  severity: ReconciliationSeverity;
}

export const RECONCILIATION_RULES: Record<
  ReconciliationExceptionKind,
  ReconciliationExceptionRule
> = {
  payment_posting_overdue: {
    kind: "payment_posting_overdue",
    label: "Payment captured, SAP posting overdue",
    // Longer than the 5 relay attempts (ADR-023) and the inline retry the
    // webhook already made could plausibly need — past this, a human should
    // look rather than wait for the next automatic attempt.
    staleAfterMs: 15 * 60 * 1000,
    severity: "critical",
  },
  payment_capture_unconfirmed: {
    kind: "payment_capture_unconfirmed",
    label: "Payment attempt unconfirmed",
    // A customer's bank/UPI app can genuinely take a few minutes; past half
    // an hour the far more likely explanation is a webhook that never
    // arrived, not a slow bank.
    staleAfterMs: 30 * 60 * 1000,
    severity: "warning",
  },
  outbox_event_failed: {
    kind: "outbox_event_failed",
    label: "Event exhausted its relay attempts",
    // A `failed` row has already used up `OUTBOX_MAX_ATTEMPTS` — there is no
    // "still in flight" reading of this state, so it is an exception the
    // instant it's reached.
    staleAfterMs: 0,
    severity: "critical",
  },
};

export interface ReconciliationException {
  kind: ReconciliationExceptionKind;
  label: string;
  severity: ReconciliationSeverity;
  ageMs: number;
}

/**
 * Classifies a payment row. `captured` past its threshold means SAP hasn't
 * confirmed the posting; `initiated` with a gateway reference past its
 * (longer) threshold means the webhook that was supposed to advance it never
 * arrived. Anything else — `posted`, `failed`, `cancelled`, or an
 * `initiated` row with no gateway attempt yet — is not an exception.
 */
export function classifyPaymentException(
  payment: {
    state: string;
    gatewayReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date,
): ReconciliationException | null {
  if (payment.state === "captured") {
    const rule = RECONCILIATION_RULES.payment_posting_overdue;
    const ageMs = now.getTime() - payment.updatedAt.getTime();
    if (ageMs < rule.staleAfterMs) return null;
    return { kind: rule.kind, label: rule.label, severity: rule.severity, ageMs };
  }

  if (payment.state === "initiated" && payment.gatewayReference) {
    const rule = RECONCILIATION_RULES.payment_capture_unconfirmed;
    const ageMs = now.getTime() - payment.createdAt.getTime();
    if (ageMs < rule.staleAfterMs) return null;
    return { kind: rule.kind, label: rule.label, severity: rule.severity, ageMs };
  }

  return null;
}

/** Classifies an outbox row. Only `failed` rows are exceptions — `pending`
 * and `publishing` are the relay's own business, and it already reclaims a
 * row stuck in `publishing` on every sweep (ADR-023). */
export function classifyOutboxException(
  event: { state: string; occurredAt: Date },
  now: Date,
): ReconciliationException | null {
  if (event.state !== "failed") return null;
  const rule = RECONCILIATION_RULES.outbox_event_failed;
  return {
    kind: rule.kind,
    label: rule.label,
    severity: rule.severity,
    ageMs: now.getTime() - event.occurredAt.getTime(),
  };
}
