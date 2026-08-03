import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  GatewayOrder,
  GatewayOrderInput,
  GatewayPayment,
  GatewayWebhookEvent,
  PaymentGateway,
  PaymentGatewayHealth,
} from "../contract";
import { PaymentGatewayError } from "../errors";

/**
 * Razorpay driver — skeleton only, wired up in Phase 7 alongside the ECC/S4
 * SAP drivers (docs/04 Phase 2: "Payments (Razorpay + webhook + SAP posting
 * + reconciliation)").
 *
 * Every method throws `not_implemented` rather than falling back to the mock
 * (ADR-006), and here the rule matters more than anywhere else in the
 * codebase: a mock fallback on a payment driver would tell a customer their
 * money had been taken when no gateway was ever called. An error is the only
 * safe answer.
 *
 * `verifyWebhookSignature` is the single exception — it is implemented, not
 * stubbed. It is pure HMAC over the raw body with the tenant's webhook
 * secret, it needs no network, and a signature check that returned `false`
 * because "the driver isn't finished" would be indistinguishable from an
 * attack in the logs.
 */

export interface RazorpayConfig {
  /** Public key id — not a secret, kept alongside the credential bag below. */
  keyId: string;
  /**
   * Decrypted once by the resolving service from the per-tenant credential
   * vault (`@cc/db`, docs/DECISIONS.md ADR-042): `keySecret` (the API
   * secret paired with `keyId`) and `webhookSecret` (used by
   * `verifyWebhookSignature` below). Held here for the adapter's lifetime,
   * never logged, never round-tripped back to storage.
   */
  credentials: { keySecret: string; webhookSecret: string };
  baseUrl?: string;
}

export class RazorpayGateway implements PaymentGateway {
  readonly driver = "razorpay" as const;

  constructor(private readonly config: RazorpayConfig) {}

  async health(): Promise<PaymentGatewayHealth> {
    return { reachable: false, driver: this.driver, checkedAt: new Date().toISOString() };
  }

  async createOrder(_input: GatewayOrderInput): Promise<GatewayOrder> {
    throw this.notImplemented("orders.create");
  }

  async getPayment(_gatewayReference: string): Promise<GatewayPayment> {
    throw this.notImplemented("payments.fetch");
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    // Implemented deliberately — see the note above. Razorpay signs the raw
    // body with HMAC-SHA256 (hex) under the webhook secret.
    const expected = createHmac("sha256", this.config.credentials.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");

    const given = Buffer.from(signature ?? "", "utf8");
    const want = Buffer.from(expected, "utf8");
    if (given.length !== want.length) return false;
    return timingSafeEqual(given, want);
  }

  parseWebhook(_rawBody: string, _signature: string): GatewayWebhookEvent {
    throw this.notImplemented("webhook parsing");
  }

  private notImplemented(operation: string): PaymentGatewayError {
    return new PaymentGatewayError("Online payment isn't available for this tenant yet.", {
      kind: "not_implemented",
      upstreamMessage: `razorpay driver not implemented (${operation}, key ${this.config.keyId})`,
    });
  }
}
