import { beforeEach, describe, expect, it } from "vitest";

import { isPaymentGatewayError } from "../errors";

import { MOCK_WEBHOOK_SECRET, MockPaymentGateway, outcomeFor, signWebhook } from "./driver";

describe("MockPaymentGateway", () => {
  let gateway: MockPaymentGateway;

  beforeEach(() => {
    gateway = new MockPaymentGateway();
  });

  async function order(amount = 1000, reference = "pmt_1") {
    return gateway.createOrder({ amount, currency: "INR", reference, method: "upi" });
  }

  describe("createOrder", () => {
    it("creates an attempt that has captured nothing yet", async () => {
      const created = await order();

      expect(created.status).toBe("created");
      expect(created.gatewayReference).toMatch(/^pay_/);
      expect(created.checkoutUrl).toContain(created.gatewayReference);
    });

    it("is idempotent on the portal reference, so a double click can't charge twice", async () => {
      const first = await order(1000, "pmt_1");
      const second = await order(1000, "pmt_1");

      expect(second.gatewayReference).toBe(first.gatewayReference);
    });

    it("treats a different portal payment as a different attempt", async () => {
      const first = await order(1000, "pmt_1");
      const second = await order(1000, "pmt_2");

      expect(second.gatewayReference).not.toBe(first.gatewayReference);
    });

    it("mints references that don't collide across restarts", async () => {
      // A bare counter would hand out pay_…000001 again after every process
      // restart and collide with payments already stored under the portal's
      // permanent (tenantId, gatewayReference) uniqueness (ADR-021).
      const restarted = new MockPaymentGateway();

      const before = await order(1000, "pmt_1");
      const after = await restarted.createOrder({
        amount: 1000,
        currency: "INR",
        reference: "pmt_1",
      });

      expect(after.gatewayReference).not.toBe(before.gatewayReference);
    });

    it("rejects a zero or negative amount", async () => {
      await expect(
        gateway.createOrder({ amount: 0, currency: "INR", reference: "pmt_x" }),
      ).rejects.toMatchObject({ kind: "invalid_request" });
    });
  });

  describe("webhook signatures", () => {
    it("accepts a correctly signed body", () => {
      const body = JSON.stringify({ hello: "world" });
      expect(gateway.verifyWebhookSignature(body, signWebhook(body))).toBe(true);
    });

    it("rejects a tampered body", () => {
      const body = JSON.stringify({ amount: 100 });
      const signature = signWebhook(body);
      const tampered = JSON.stringify({ amount: 100000 });

      expect(gateway.verifyWebhookSignature(tampered, signature)).toBe(false);
    });

    it("rejects a signature made with the wrong secret", () => {
      const body = JSON.stringify({ hello: "world" });
      expect(gateway.verifyWebhookSignature(body, signWebhook(body, "not-the-secret"))).toBe(false);
    });

    it("rejects an empty or malformed signature rather than throwing", () => {
      const body = JSON.stringify({ hello: "world" });
      expect(gateway.verifyWebhookSignature(body, "")).toBe(false);
      expect(gateway.verifyWebhookSignature(body, "abc")).toBe(false);
    });

    it("refuses to parse a body whose signature doesn't verify", () => {
      const body = JSON.stringify({
        eventId: "e1",
        type: "payment.captured",
        gatewayReference: "x",
      });

      try {
        gateway.parseWebhook(body, "deadbeef");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(isPaymentGatewayError(error) && error.kind).toBe("invalid_signature");
      }
    });

    it("honours a per-tenant secret", () => {
      const tenant = new MockPaymentGateway({ webhookSecret: "tenant-secret" });
      const body = JSON.stringify({ hello: "world" });

      expect(tenant.verifyWebhookSignature(body, signWebhook(body, "tenant-secret"))).toBe(true);
      expect(tenant.verifyWebhookSignature(body, signWebhook(body, MOCK_WEBHOOK_SECRET))).toBe(
        false,
      );
    });
  });

  describe("the webhook is what advances a payment", () => {
    it("leaves the payment uncaptured until a webhook arrives", async () => {
      const created = await order();

      expect((await gateway.getPayment(created.gatewayReference)).status).toBe("created");
    });

    it("captures on payment.captured", async () => {
      const created = await order();
      const { body, signature } = gateway.buildWebhook(created.gatewayReference);

      const event = gateway.parseWebhook(body, signature);

      expect(event.type).toBe("payment.captured");
      expect(event.payment.status).toBe("captured");
      expect(event.payment.capturedAt).toBeTruthy();
      expect((await gateway.getPayment(created.gatewayReference)).status).toBe("captured");
    });

    it("is safe to replay: the same event twice leaves the same state", async () => {
      const created = await order();
      const { body, signature } = gateway.buildWebhook(created.gatewayReference);

      const first = gateway.parseWebhook(body, signature);
      const second = gateway.parseWebhook(body, signature);

      // The driver does not suppress the replay — it reports the same event
      // id, so the *service* can dedupe. That's where the DB constraint is.
      expect(second.eventId).toBe(first.eventId);
      expect(second.payment.status).toBe("captured");
    });

    it("rejects a webhook for an unknown payment", () => {
      const body = JSON.stringify({
        eventId: "e1",
        type: "payment.captured",
        gatewayReference: "pay_99999999",
      });

      expect(() => gateway.parseWebhook(body, signWebhook(body))).toThrowError(/unknown payment/i);
    });

    it("rejects a verified body that is missing fields", () => {
      const body = JSON.stringify({ eventId: "e1" });

      try {
        gateway.parseWebhook(body, signWebhook(body));
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(isPaymentGatewayError(error) && error.kind).toBe("invalid_request");
      }
    });
  });

  describe("deterministic outcomes", () => {
    it("selects the outcome from the paise so every return state is reachable", () => {
      expect(outcomeFor(1000)).toBe("captured");
      expect(outcomeFor(687871.56)).toBe("captured");
      expect(outcomeFor(100.11)).toBe("pending");
      expect(outcomeFor(100.13)).toBe("failed");
    });

    it("carries a failure reason for the logs on a failed payment", async () => {
      const created = await order(100.13, "pmt_fail");
      const { body, signature } = gateway.buildWebhook(created.gatewayReference);

      const event = gateway.parseWebhook(body, signature);

      expect(event.type).toBe("payment.failed");
      expect(event.payment.failureReason).toBeTruthy();
      expect(event.payment.capturedAt).toBeUndefined();
    });

    it("leaves a pending payment pending", async () => {
      const created = await order(100.11, "pmt_pending");
      const { body, signature } = gateway.buildWebhook(created.gatewayReference);

      expect(gateway.parseWebhook(body, signature).payment.status).toBe("pending");
    });
  });

  describe("outage simulation", () => {
    it("fails every call retryably, and says nothing was charged", async () => {
      const down = new MockPaymentGateway({ unavailable: true });

      await expect(
        down.createOrder({ amount: 100, currency: "INR", reference: "pmt_1" }),
      ).rejects.toMatchObject({ kind: "unavailable", retryable: true });
      await expect(
        down.createOrder({ amount: 100, currency: "INR", reference: "pmt_1" }),
      ).rejects.toThrowError(/nothing has been charged/i);
    });

    it("reports itself unreachable to health checks", async () => {
      const down = new MockPaymentGateway({ unavailable: true });
      expect((await down.health()).reachable).toBe(false);
    });
  });
});
