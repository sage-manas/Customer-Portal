import { MockSapAdapter } from "@cc/adapter-sap";
import type { SalesOrderInput } from "@cc/domain";
import { describe, expect, it } from "vitest";

import {
  cancelOrder,
  checkAvailability,
  createOrder,
  displayStatus,
  getOrder,
  getOrderFormDefaults,
  listOrders,
} from "./order-service";

/**
 * The order module against the mock SAP driver. Nothing here touches the
 * database — orders are SAP's, so the service is pure composition and can be
 * tested without one (the draft, which is stored, has its own Postgres suite
 * in src/__tests__).
 */

const KUNNR = "0010001001";
/** Deccan Fabricators — seeded at 98% credit utilisation. */
const TIGHT_CREDIT = "0010001002";

const sap = (options = {}) => new MockSapAdapter(options);

const order = (over: Partial<SalesOrderInput> = {}): SalesOrderInput => ({
  customerPoRef: `PO-${Math.random().toString(36).slice(2, 10)}`,
  requestedDeliveryDate: "2026-08-20",
  shipTo: KUNNR,
  lines: [{ material: "MAT-10001", quantity: 2, uom: "EA" }],
  ...over,
});

describe("listOrders", () => {
  it("returns the account's orders with the read's own freshness", async () => {
    const result = await listOrders(sap(), KUNNR);

    expect(result.orders.length).toBeGreaterThan(0);
    expect(result.orders.every((o) => o.kunnr === KUNNR)).toBe(true);
    expect(result.freshness).toBe("live");
  });

  it("filters by the customer's own vocabulary, not by SAP codes", async () => {
    const open = await listOrders(sap(), KUNNR, { filter: "open" });
    expect(open.orders.every((o) => o.orderStatus !== "Closed")).toBe(true);

    const completed = await listOrders(sap(), KUNNR, { filter: "completed" });
    expect(completed.orders.every((o) => o.orderStatus === "Closed")).toBe(true);

    const held = await listOrders(sap(), TIGHT_CREDIT, { filter: "creditHold" });
    expect(held.orders.every((o) => o.creditStatus === "CreditHold")).toBe(true);
    expect(held.total).toBe(held.orders.length);
  });

  it("refuses to guess an account", async () => {
    await expect(listOrders(sap(), undefined)).rejects.toMatchObject({
      code: "no_account",
      status: 409,
    });
  });

  it("surfaces a SAP outage as retryable rather than empty", async () => {
    await expect(listOrders(sap({ unavailable: true }), KUNNR)).rejects.toMatchObject({
      code: "upstream_unavailable",
      status: 503,
    });
  });
});

describe("getOrder", () => {
  it("composes the order with its deliveries, invoices and the O2C timeline", async () => {
    // 0000004711 is the seeded closed order: delivered, invoiced.
    const detail = await getOrder(sap(), KUNNR, "0000004711");

    expect(detail.order.vbeln).toBe("0000004711");
    expect(detail.deliveries.map((d) => d.vbeln)).toContain("0080001901");
    expect(detail.invoices.map((i) => i.vbeln)).toContain("0090002211");

    expect(detail.timeline.map((s) => s.key)).toEqual([
      "order",
      "creditCheck",
      "delivery",
      "invoice",
      "payment",
    ]);
    expect(detail.timeline.find((s) => s.key === "delivery")?.status).toBe("Delivered");
  });

  it("shows another customer's order as not found, never forbidden", async () => {
    // 0000004713 belongs to Deccan Fabricators.
    await expect(getOrder(sap(), KUNNR, "0000004713")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("gives an unknown order number the same answer as another customer's", async () => {
    await expect(getOrder(sap(), KUNNR, "0000009999")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("still renders the order when the billing read fails", async () => {
    const adapter = sap();
    adapter.getInvoices = () => Promise.reject(new Error("VBRK unavailable"));

    const detail = await getOrder(adapter, KUNNR, "0000004711");
    expect(detail.order.vbeln).toBe("0000004711");
    expect(detail.invoices).toEqual([]);
    expect(detail.timeline.find((s) => s.key === "invoice")?.status).toBeNull();
  });

  it("offers Cancel only while the order is fully open", async () => {
    // 0000004712 is part-delivered; 0000004713 is open (on credit hold).
    expect((await getOrder(sap(), KUNNR, "0000004712")).cancellable).toBe(false);
    expect((await getOrder(sap(), TIGHT_CREDIT, "0000004713")).cancellable).toBe(true);
  });
});

describe("checkAvailability (ATP)", () => {
  it("confirms in full on the requested date when stock covers the line", async () => {
    const result = await checkAvailability(sap(), KUNNR, order());

    expect(result.fullyConfirmed).toBe(true);
    expect(result.lines[0]!.confirmedQty).toBe(2);
    expect(result.lines[0]!.confirmedDate).toBe("2026-08-20");
    expect(result.netValue).toBeGreaterThan(0);
  });

  it("reports a partial confirmation with the date SAP would give", async () => {
    // MAT-10002 has 8 EA in stock.
    const result = await checkAvailability(
      sap(),
      KUNNR,
      order({ lines: [{ material: "MAT-10002", quantity: 50, uom: "EA" }] }),
    );

    expect(result.fullyConfirmed).toBe(false);
    expect(result.lines[0]!.partial).toBe(true);
    expect(result.lines[0]!.confirmedQty).toBe(8);
    expect(result.lines[0]!.confirmedDate).not.toBe("2026-08-20");
  });

  it("warns about the credit gate before anything is submitted", async () => {
    const result = await checkAvailability(
      sap(),
      TIGHT_CREDIT,
      order({ shipTo: TIGHT_CREDIT, lines: [{ material: "MAT-10001", quantity: 10, uom: "EA" }] }),
    );

    expect(result.creditBlockExpected).toBe(true);
  });

  it("validates against the registry before calling SAP", async () => {
    await expect(
      checkAvailability(sap(), KUNNR, order({ requestedDeliveryDate: "20-08-2026" })),
    ).rejects.toMatchObject({ code: "invalid", status: 422 });

    await expect(checkAvailability(sap(), KUNNR, order({ lines: [] }))).rejects.toMatchObject({
      code: "invalid",
      status: 422,
    });
  });

  it("reports a SAP business rejection against its field, not as an outage", async () => {
    // MVKE-MINBM for MAT-10003 is 5.
    await expect(
      checkAvailability(
        sap(),
        KUNNR,
        order({ lines: [{ material: "MAT-10003", quantity: 2, uom: "EA" }] }),
      ),
    ).rejects.toMatchObject({ code: "rejected", status: 422 });
  });
});

describe("createOrder", () => {
  it("creates an order that is then readable at its VBELN", async () => {
    const adapter = sap();
    const created = await createOrder(adapter, KUNNR, order({ customerPoRef: "PO-NEW-1" }));

    expect(created.vbeln).toMatch(/^\d{10}$/);
    expect(created.orderStatus).toBe("Open");
    expect(created.creditStatus).toBe("Confirmed");

    const detail = await getOrder(adapter, KUNNR, created.vbeln);
    expect(detail.order.customerPoRef).toBe("PO-NEW-1");
  });

  it("is idempotent on the customer PO reference, so a double submit costs nothing", async () => {
    const adapter = sap();
    const input = order({ customerPoRef: "PO-DOUBLE-CLICK" });

    const first = await createOrder(adapter, KUNNR, input);
    const second = await createOrder(adapter, KUNNR, input);

    expect(second.vbeln).toBe(first.vbeln);
  });

  it("creates — does not refuse — an order that trips the credit check", async () => {
    const created = await createOrder(
      sap(),
      TIGHT_CREDIT,
      order({ shipTo: TIGHT_CREDIT, lines: [{ material: "MAT-10001", quantity: 10, uom: "EA" }] }),
    );

    expect(created.creditStatus).toBe("CreditHold");
    expect(created.lines.every((line) => line.confirmedQty === 0)).toBe(true);
  });

  it("submits nothing when SAP is unreachable, and says so", async () => {
    await expect(createOrder(sap({ unavailable: true }), KUNNR, order())).rejects.toMatchObject({
      code: "upstream_unavailable",
      status: 503,
    });
  });
});

describe("cancelOrder", () => {
  it("cancels an open order and releases its credit exposure", async () => {
    const adapter = sap();
    const created = await createOrder(adapter, KUNNR, order({ customerPoRef: "PO-CANCELME" }));
    const before = await adapter.getCreditInfo(KUNNR);

    const cancelled = await cancelOrder(adapter, KUNNR, created.vbeln, "Ordered in error");
    expect(cancelled.orderStatus).toBe("Closed");

    const after = await adapter.getCreditInfo(KUNNR);
    expect(after.data.utilized).toBe(before.data.utilized - created.netValue);
  });

  it("re-reads the status rather than trusting the screen the button was on", async () => {
    // 0000004712 is part-delivered, so it is past cancellation.
    await expect(cancelOrder(sap(), KUNNR, "0000004712")).rejects.toMatchObject({
      code: "not_allowed",
      status: 409,
    });
  });

  it("will not cancel another customer's order, and does not admit it exists", async () => {
    await expect(cancelOrder(sap(), KUNNR, "0000004713")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });
});

describe("getOrderFormDefaults", () => {
  it("pre-fills the ship-to list and the customer's agreed payment terms", async () => {
    const defaults = await getOrderFormDefaults(sap(), KUNNR);

    expect(defaults.shipTos.length).toBeGreaterThan(1);
    expect(defaults.paymentTerms).toBe("NT30");
    expect(defaults.credit?.creditLimit).toBeGreaterThan(0);
  });

  it("keeps the form usable when the customer has no credit master", async () => {
    const adapter = sap();
    adapter.getCreditInfo = () => Promise.reject(new Error("no KNKK row"));

    const defaults = await getOrderFormDefaults(adapter, KUNNR);
    expect(defaults.credit).toBeNull();
    expect(defaults.shipTos.length).toBeGreaterThan(0);
  });
});

describe("displayStatus", () => {
  it("lets a credit hold outrank the overall status — it is the actionable one", () => {
    expect(displayStatus({ orderStatus: "Open", creditStatus: "CreditHold" })).toBe("CreditHold");
    expect(displayStatus({ orderStatus: "Open", creditStatus: "Confirmed" })).toBe("Open");
  });
});
