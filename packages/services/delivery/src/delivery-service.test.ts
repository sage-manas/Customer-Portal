import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import {
  getPodFormDefaults,
  listDeliveries,
  previewPodDiscrepancy,
  toDeliveryError,
} from "./delivery-service";
import { isDeliveryError } from "./errors";

/**
 * The read side of the delivery module, against the mock SAP driver. Nothing
 * here touches Postgres — the POD write path, which is the only stored part,
 * has its own Postgres-backed suite in `__tests__/pod-flow.test.ts`.
 */

const KUNNR = "0010001001";
/** Deccan Fabricators — has an order but no deliveries of their own. */
const OTHER_KUNNR = "0010001002";

const sap = () => new MockSapAdapter({ today: "2026-07-26" });

async function expectDeliveryError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isDeliveryError(error)) return error;
    throw error;
  }
  throw new Error("Expected a DeliveryError to be thrown");
}

describe("listDeliveries", () => {
  it("returns the account's shipments with their stepper, freshness and all", async () => {
    const result = await listDeliveries(sap(), KUNNR);

    expect(result.total).toBe(3);
    expect(result.freshness).toBe("live");
    expect(result.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.deliveries.every((d) => d.stages.length === 5)).toBe(true);
  });

  it("puts shipments still in flight above ones already delivered", async () => {
    // The customer opening this screen is asking "where are my goods?" — a
    // consignment that arrived last month is history.
    const result = await listDeliveries(sap(), KUNNR);

    expect(result.deliveries.map((d) => d.status)).toEqual(["Packed", "InTransit", "Delivered"]);
  });

  it("flags only the shipments the customer still owes a signature for", async () => {
    const result = await listDeliveries(sap(), KUNNR);

    // 0080001901 is signed for, 0080001960 hasn't been despatched — only the
    // one in transit is awaiting a POD.
    expect(result.deliveries.filter((d) => d.awaitingPod).map((d) => d.vbeln)).toEqual([
      "0080001947",
    ]);
  });

  it("filters, and reports the filtered count rather than the unfiltered one", async () => {
    const result = await listDeliveries(sap(), KUNNR, { filter: "awaitingPod" });

    expect(result.deliveries).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("shows a customer with no deliveries an empty list, not an error", async () => {
    const result = await listDeliveries(sap(), OTHER_KUNNR);
    expect(result.deliveries).toEqual([]);
  });

  it("refuses a session with no sold-to account", async () => {
    const error = await expectDeliveryError(() => listDeliveries(sap(), undefined));
    expect(error.code).toBe("no_account");
    expect(error.status).toBe(409);
  });

  it("surfaces a SAP outage as retryable rather than as an empty list", async () => {
    const down = new MockSapAdapter({ unavailable: true });
    const error = await expectDeliveryError(() => listDeliveries(down, KUNNR));

    expect(error.code).toBe("upstream_unavailable");
    expect(error.status).toBe(503);
  });
});

describe("getPodFormDefaults", () => {
  it("pre-fills every line at the dispatched quantity", async () => {
    const defaults = await getPodFormDefaults(sap(), KUNNR, "0080001947");

    expect(defaults.lines).toEqual([{ lineNo: 10, receivedQty: 150 }]);
    expect(defaults.order?.vbeln).toBe("0000004712");
  });

  it("refuses a delivery that has not left the warehouse", async () => {
    const error = await expectDeliveryError(() => getPodFormDefaults(sap(), KUNNR, "0080001960"));

    expect(error.code).toBe("not_allowed");
    expect(error.status).toBe(409);
  });

  it("refuses one that has already been signed for", async () => {
    const error = await expectDeliveryError(() => getPodFormDefaults(sap(), KUNNR, "0080001901"));
    expect(error.code).toBe("not_allowed");
  });

  it("404s another customer's delivery, and says nothing more", async () => {
    // The delivery exists — but not for this account. The answer must be
    // indistinguishable from one for a number that never existed.
    const error = await expectDeliveryError(() =>
      getPodFormDefaults(sap(), OTHER_KUNNR, "0080001947"),
    );

    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).toBe("We couldn't find that delivery.");
  });

  it("404s a delivery that does not exist at all — the same answer", async () => {
    const error = await expectDeliveryError(() => getPodFormDefaults(sap(), KUNNR, "0080009999"));
    expect(error.code).toBe("not_found");
  });
});

describe("previewPodDiscrepancy", () => {
  it("lets the screen label its button from the same rule the write path uses", async () => {
    const defaults = await getPodFormDefaults(sap(), KUNNR, "0080001947");

    expect(previewPodDiscrepancy(defaults.delivery, defaults.lines).hasDiscrepancy).toBe(false);
    expect(
      previewPodDiscrepancy(defaults.delivery, [{ lineNo: 10, receivedQty: 140 }]).hasDiscrepancy,
    ).toBe(true);
  });
});

describe("toDeliveryError", () => {
  it("maps a SAP validation refusal to not_allowed, not to a 500", async () => {
    const error = await expectDeliveryError(async () => {
      // Already signed for — the mock refuses it the way SAP does.
      await sap()
        .confirmPod({
          deliveryVbeln: "0080001901",
          receiptDate: "2026-07-26",
          lines: [{ lineNo: 10, receivedQty: 12 }],
        })
        .catch((e: unknown) => {
          throw toDeliveryError(e, "delivery", "0080001901");
        });
    });

    expect(error.code).toBe("not_allowed");
  });

  it("maps a non-SAP failure to upstream_unavailable rather than leaking it", async () => {
    const error = toDeliveryError(new Error("socket hang up"), "delivery");
    expect(error.code).toBe("upstream_unavailable");
  });
});
