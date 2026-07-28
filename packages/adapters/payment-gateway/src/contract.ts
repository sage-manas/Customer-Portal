/**
 * Payment gateway (docs/02-TRD-ARCHITECTURE.md §6, docs/03 Screen 7.2,
 * docs/05 §7.7 — "step 3: gateway redirect/modal; return states Success /
 * Pending / Failed").
 *
 * Mock-first like every external system: the `mock` driver is built first
 * and is what every pre-production tenant runs on. Service code depends on
 * this interface and resolves a driver per tenant through
 * `createPaymentGateway` — it never imports a driver.
 *
 * The contract is shaped around the one thing that makes payments different
 * from the rest of the O2C chain: **the webhook is the source of truth, not
 * the browser redirect.** A customer's browser can close, lose signal, or be
 * replayed; the gateway's signed server-to-server callback cannot. So the
 * interface exposes signature verification and parsing as first-class
 * operations, and every driver must make them safe to call repeatedly
 * (docs/02 §6: "webhook (signed, idempotent)").
 */

export type PaymentGatewayName = "mock" | "razorpay";

/** What the gateway did with an attempt, in the gateway's own vocabulary. */
export type GatewayPaymentStatus =
  /** Created at the gateway, customer hasn't completed it yet. */
  | "created"
  /** Money taken. Terminal and irreversible from the portal's side. */
  | "captured"
  /** Customer's bank/UPI is still deciding — poll or wait for the webhook. */
  | "pending"
  | "failed";

export interface GatewayOrderInput {
  /** Minor units are the gateway convention; this is rupees, converted by the driver. */
  amount: number;
  currency: string;
  /**
   * The portal's own payment id. Passed as the gateway's `receipt`/reference
   * so a webhook can always be traced back to one portal payment, and so a
   * retried create doesn't produce a second charge.
   */
  reference: string;
  /** Preferred method, when the customer chose one (UPI/card/...). */
  method?: string;
  /** Free-form context echoed back on the webhook (tenant, KUNNR). */
  notes?: Record<string, string>;
}

export interface GatewayOrder {
  /** The gateway's id for this attempt — BSEG-KIDNO once posted. */
  gatewayReference: string;
  status: GatewayPaymentStatus;
  amount: number;
  currency: string;
  /** Where to send the customer. The mock returns a portal-local URL. */
  checkoutUrl: string;
  createdAt: string;
}

export interface GatewayPayment {
  gatewayReference: string;
  /** The portal payment id this attempt belongs to. */
  reference: string;
  status: GatewayPaymentStatus;
  amount: number;
  currency: string;
  method?: string;
  /** Gateway's reason for a failure — for logs, never shown raw to a customer. */
  failureReason?: string;
  capturedAt?: string;
}

/** A verified, parsed webhook. Drivers only produce one after checking the signature. */
export interface GatewayWebhookEvent {
  /** Gateway's event id — the deduplication key for at-least-once delivery. */
  eventId: string;
  type: "payment.captured" | "payment.failed" | "payment.pending";
  payment: GatewayPayment;
  receivedAt: string;
}

export interface PaymentGatewayHealth {
  reachable: boolean;
  driver: PaymentGatewayName;
  checkedAt: string;
}

export interface PaymentGateway {
  readonly driver: PaymentGatewayName;
  health(): Promise<PaymentGatewayHealth>;

  /**
   * Creates the payment attempt. Idempotent on `reference`: calling twice for
   * the same portal payment returns the same gateway order rather than
   * charging twice — a double-clicked Pay button must cost nothing.
   */
  createOrder(input: GatewayOrderInput): Promise<GatewayOrder>;

  /** Polls one attempt — the Pending return state (docs/05 §7.7). */
  getPayment(gatewayReference: string): Promise<GatewayPayment>;

  /**
   * Verifies the webhook signature over the *raw* body. Takes the raw string
   * rather than a parsed object on purpose: re-serializing JSON changes the
   * bytes and breaks every HMAC scheme in use.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;

  /**
   * Parses a webhook body that has already passed `verifyWebhookSignature`.
   * Throws `PaymentGatewayError` with kind `invalid_signature` if asked to
   * parse something unverified, so the check cannot be skipped by accident.
   */
  parseWebhook(rawBody: string, signature: string): GatewayWebhookEvent;
}
