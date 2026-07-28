import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
 * In-memory payment gateway simulation.
 *
 * It models the three things that actually make gateway integrations hard,
 * because a mock that only walks the happy path would let all three ship
 * broken (docs/06: the mock is what the whole team develops against):
 *
 *  1. **The webhook is the truth.** Nothing is captured by `createOrder`.
 *     A payment only advances when a signed webhook arrives — the same shape
 *     the route handler will receive from Razorpay in Phase 7.
 *  2. **Signatures are real.** HMAC-SHA256 over the raw body, compared in
 *     constant time. `signWebhook` is exported so the dev checkout page and
 *     the tests can mint valid callbacks; nothing else can.
 *  3. **Delivery is at-least-once.** `parseWebhook` is pure, and the same
 *     event id may legitimately arrive twice — deduplication belongs to the
 *     service, and this driver makes it easy to test by never suppressing a
 *     replay itself.
 *
 * Outcomes are deterministic in the amount so every return state in doc 05
 * §7.7 is reachable without wiring up a fake bank: see `outcomeFor`.
 */

export interface MockPaymentGatewayOptions {
  /** Artificial latency, so the checkout spinner is a real state. */
  latencyMs?: number;
  /** When true every call fails with a retryable `unavailable` error. */
  unavailable?: boolean;
  /** Fixed clock for deterministic timestamps in tests. */
  now?: () => Date;
  /** Webhook signing secret. Per tenant in real life; fixed here for dev. */
  webhookSecret?: string;
  /** Where the mock checkout page lives, for `checkoutUrl`. */
  checkoutBaseUrl?: string;
}

export const MOCK_WEBHOOK_SECRET = "mock-gateway-secret";

/**
 * Deterministic outcome selection, so a demo or a test can reach Pending and
 * Failed without special APIs. The paise (fractional) part decides:
 *
 *  - `.11` → the payment stays `pending` (the polling banner)
 *  - `.13` → the payment fails (the retry state, "no double charge" copy)
 *  - anything else → captured
 *
 * Chosen on the fraction rather than the rupee value because real invoice
 * totals carry GST and land on arbitrary paise anyway, so no realistic seed
 * amount collides with these by accident.
 */
export function outcomeFor(amount: number): "captured" | "pending" | "failed" {
  const paise = Math.round(amount * 100) % 100;
  if (paise === 11) return "pending";
  if (paise === 13) return "failed";
  return "captured";
}

interface StoredOrder {
  order: GatewayOrder;
  payment: GatewayPayment;
}

export class MockPaymentGateway implements PaymentGateway {
  readonly driver = "mock" as const;

  private readonly options: Required<MockPaymentGatewayOptions>;
  /** Keyed by gateway reference. */
  private readonly orders = new Map<string, StoredOrder>();
  /** Portal reference -> gateway reference, for create idempotency. */
  private readonly byReference = new Map<string, string>();
  private sequence = 1;
  /**
   * Per-instance token, so a gateway reference is unique across process
   * restarts as a real gateway's is. A bare counter restarts at 1 whenever
   * the dev server does, and collides with the payments an earlier run
   * already wrote — the portal's `(tenantId, gatewayReference)` uniqueness
   * (ADR-021) is permanent, so the mock has to be too.
   */
  private readonly instance = randomBytes(4).toString("hex");

  constructor(options: MockPaymentGatewayOptions = {}) {
    this.options = {
      latencyMs: options.latencyMs ?? 0,
      unavailable: options.unavailable ?? false,
      now: options.now ?? (() => new Date()),
      webhookSecret: options.webhookSecret ?? MOCK_WEBHOOK_SECRET,
      checkoutBaseUrl: options.checkoutBaseUrl ?? "/payments/checkout",
    };
  }

  async health(): Promise<PaymentGatewayHealth> {
    return {
      reachable: !this.options.unavailable,
      driver: this.driver,
      checkedAt: this.options.now().toISOString(),
    };
  }

  async createOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
    await this.simulateCall();

    if (!(input.amount > 0)) {
      throw new PaymentGatewayError("A payment must be for more than zero.", {
        kind: "invalid_request",
      });
    }
    if (!input.reference) {
      throw new PaymentGatewayError("A payment attempt needs a portal reference.", {
        kind: "invalid_request",
      });
    }

    // Idempotent on the portal's reference: a double-clicked Pay button, or a
    // retry after a timeout, must not create a second chargeable attempt.
    const existing = this.byReference.get(input.reference);
    if (existing) return clone(this.orders.get(existing)!.order);

    const gatewayReference = `pay_${this.instance}${String(this.sequence++).padStart(6, "0")}`;
    const createdAt = this.options.now().toISOString();

    const order: GatewayOrder = {
      gatewayReference,
      status: "created",
      amount: round2(input.amount),
      currency: input.currency,
      checkoutUrl: `${this.options.checkoutBaseUrl}/${gatewayReference}`,
      createdAt,
    };

    this.orders.set(gatewayReference, {
      order,
      payment: {
        gatewayReference,
        reference: input.reference,
        status: "created",
        amount: order.amount,
        currency: order.currency,
        method: input.method,
      },
    });
    this.byReference.set(input.reference, gatewayReference);

    return clone(order);
  }

  async getPayment(gatewayReference: string): Promise<GatewayPayment> {
    await this.simulateCall();

    const stored = this.orders.get(gatewayReference);
    if (!stored) {
      throw new PaymentGatewayError("No such payment.", { kind: "not_found" });
    }
    return clone(stored.payment);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = signWebhook(rawBody, this.options.webhookSecret);
    const given = Buffer.from(signature ?? "", "utf8");
    const want = Buffer.from(expected, "utf8");
    // Constant-time: a length-leaking or short-circuiting compare on a
    // signature is the classic way this check gets quietly defeated.
    if (given.length !== want.length) return false;
    return timingSafeEqual(given, want);
  }

  parseWebhook(rawBody: string, signature: string): GatewayWebhookEvent {
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new PaymentGatewayError("Webhook signature did not verify.", {
        kind: "invalid_signature",
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (cause) {
      throw new PaymentGatewayError("Webhook body was not valid JSON.", {
        kind: "invalid_request",
        cause,
      });
    }

    const event = body as {
      eventId?: string;
      type?: GatewayWebhookEvent["type"];
      gatewayReference?: string;
    };
    if (!event.eventId || !event.type || !event.gatewayReference) {
      throw new PaymentGatewayError("Webhook body was missing required fields.", {
        kind: "invalid_request",
      });
    }

    const stored = this.orders.get(event.gatewayReference);
    if (!stored) {
      throw new PaymentGatewayError("Webhook referenced an unknown payment.", {
        kind: "not_found",
      });
    }

    // The webhook is what moves the attempt on — the same as production.
    const status =
      event.type === "payment.captured"
        ? "captured"
        : event.type === "payment.failed"
          ? "failed"
          : "pending";

    stored.payment = {
      ...stored.payment,
      status,
      capturedAt: status === "captured" ? this.options.now().toISOString() : undefined,
      failureReason:
        status === "failed" ? "Payment declined by the customer's bank (simulated)." : undefined,
    };
    stored.order = { ...stored.order, status };

    return {
      eventId: event.eventId,
      type: event.type,
      payment: clone(stored.payment),
      receivedAt: this.options.now().toISOString(),
    };
  }

  // ---- Test/dev affordances (not part of the contract) ------------------

  /**
   * Builds the signed webhook the mock checkout page posts back. This is the
   * only way to produce a valid callback, which keeps the dev flow honest:
   * the portal still learns about the payment from a verified webhook rather
   * than from its own redirect.
   */
  buildWebhook(gatewayReference: string): { body: string; signature: string } {
    const stored = this.orders.get(gatewayReference);
    if (!stored) {
      throw new PaymentGatewayError("No such payment.", { kind: "not_found" });
    }

    const outcome = outcomeFor(stored.payment.amount);
    const body = JSON.stringify({
      eventId: `evt_${gatewayReference}_${outcome}`,
      type: `payment.${outcome}` as GatewayWebhookEvent["type"],
      gatewayReference,
    });

    return { body, signature: signWebhook(body, this.options.webhookSecret) };
  }

  private async simulateCall(): Promise<void> {
    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
    if (this.options.unavailable) {
      throw new PaymentGatewayError(
        "We couldn't reach the payment gateway just now. Nothing has been charged — please try again in a moment.",
        { kind: "unavailable", upstreamMessage: "mock outage simulation" },
      );
    }
  }
}

/** HMAC-SHA256 over the raw body, hex — the scheme Razorpay itself uses. */
export function signWebhook(rawBody: string, secret: string = MOCK_WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
