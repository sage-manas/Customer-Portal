import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { isPaymentGatewayError } from "./errors";
import { createPaymentGateway, resetPaymentGateway } from "./factory";

const RAZORPAY = {
  keyId: "rzp_test_key",
  credentialsRef: "vault://tenant/razorpay",
  webhookSecret: "tenant-webhook-secret",
};

describe("createPaymentGateway", () => {
  afterEach(() => resetPaymentGateway());

  it("resolves the mock driver", () => {
    const gateway = createPaymentGateway({ tenantId: "t1", driver: "mock" });
    expect(gateway.driver).toBe("mock");
  });

  it("caches per tenant, so in-flight payment state survives across requests", () => {
    const first = createPaymentGateway({ tenantId: "t1", driver: "mock" });
    const second = createPaymentGateway({ tenantId: "t1", driver: "mock" });

    expect(second).toBe(first);
  });

  it("keeps tenants apart", () => {
    const first = createPaymentGateway({ tenantId: "t1", driver: "mock" });
    const second = createPaymentGateway({ tenantId: "t2", driver: "mock" });

    expect(second).not.toBe(first);
  });

  it("drops one tenant's gateway without disturbing another's", () => {
    const t1 = createPaymentGateway({ tenantId: "t1", driver: "mock" });
    const t2 = createPaymentGateway({ tenantId: "t2", driver: "mock" });

    resetPaymentGateway("t1");

    expect(createPaymentGateway({ tenantId: "t1", driver: "mock" })).not.toBe(t1);
    expect(createPaymentGateway({ tenantId: "t2", driver: "mock" })).toBe(t2);
  });

  it("refuses a razorpay tenant with no gateway settings", () => {
    expect(() => createPaymentGateway({ tenantId: "t1", driver: "razorpay" })).toThrowError(
      /no gateway settings/,
    );
  });

  describe("the razorpay skeleton", () => {
    it("fails loudly rather than falling back to the mock (ADR-006)", async () => {
      const gateway = createPaymentGateway({
        tenantId: "t1",
        driver: "razorpay",
        razorpay: RAZORPAY,
      });

      await expect(
        gateway.createOrder({ amount: 100, currency: "INR", reference: "pmt_1" }),
      ).rejects.toMatchObject({ kind: "not_implemented" });
    });

    it("never tells a customer the gateway was called", async () => {
      const gateway = createPaymentGateway({
        tenantId: "t1",
        driver: "razorpay",
        razorpay: RAZORPAY,
      });

      try {
        await gateway.getPayment("pay_1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(isPaymentGatewayError(error) && error.message).toMatch(/isn't available/i);
      }
    });

    it("still verifies signatures, because a stubbed check is indistinguishable from an attack", () => {
      const gateway = createPaymentGateway({
        tenantId: "t1",
        driver: "razorpay",
        razorpay: RAZORPAY,
      });

      const body = JSON.stringify({ hello: "world" });
      const valid = createHmacHex(body, RAZORPAY.webhookSecret);

      expect(gateway.verifyWebhookSignature(body, valid)).toBe(true);
      expect(gateway.verifyWebhookSignature(body, createHmacHex(body, "wrong"))).toBe(false);
    });

    it("reports itself unreachable until Phase 7 wires it up", async () => {
      const gateway = createPaymentGateway({
        tenantId: "t1",
        driver: "razorpay",
        razorpay: RAZORPAY,
      });

      expect((await gateway.health()).reachable).toBe(false);
    });
  });
});

function createHmacHex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}
