import { beforeEach, describe, expect, it } from "vitest";

import { isSapError } from "./errors";
import { createSapAdapter, resetSapAdapter } from "./factory";

beforeEach(() => resetSapAdapter());

describe("createSapAdapter", () => {
  it("returns the mock driver for a mock tenant", () => {
    const adapter = createSapAdapter({ tenantId: "t1", driver: "mock" });
    expect(adapter.driver).toBe("mock");
  });

  it("caches one adapter per tenant so connection/store state survives", async () => {
    const first = createSapAdapter({ tenantId: "t1", driver: "mock" });
    const second = createSapAdapter({ tenantId: "t1", driver: "mock" });
    expect(second).toBe(first);

    await first.createSalesOrder({
      kunnr: "0010001001",
      customerPoRef: "PO-CACHE-1",
      requestedDeliveryDate: "2026-08-20",
      shipTo: "0010001001",
      lines: [{ material: "MAT-10003", quantity: 20, uom: "EA" }],
    });
    const orders = await second.getOrders("0010001001");
    expect(orders.data.items.some((o) => o.customerPoRef === "PO-CACHE-1")).toBe(true);
  });

  it("keeps tenants on separate adapter instances", async () => {
    const t1 = createSapAdapter({ tenantId: "t1", driver: "mock" });
    const t2 = createSapAdapter({ tenantId: "t2", driver: "mock" });
    expect(t2).not.toBe(t1);

    await t1.createSalesOrder({
      kunnr: "0010001001",
      customerPoRef: "PO-T1-ONLY",
      requestedDeliveryDate: "2026-08-20",
      shipTo: "0010001001",
      lines: [{ material: "MAT-10003", quantity: 20, uom: "EA" }],
    });
    const t2Orders = await t2.getOrders("0010001001");
    expect(t2Orders.data.items.some((o) => o.customerPoRef === "PO-T1-ONLY")).toBe(false);
  });

  it("drops only the requested tenant's adapter on reset", () => {
    const t1 = createSapAdapter({ tenantId: "t1", driver: "mock" });
    const t2 = createSapAdapter({ tenantId: "t2", driver: "mock" });
    resetSapAdapter("t1");
    expect(createSapAdapter({ tenantId: "t1", driver: "mock" })).not.toBe(t1);
    expect(createSapAdapter({ tenantId: "t2", driver: "mock" })).toBe(t2);
  });

  it("passes mock options through (outage simulation per tenant)", async () => {
    const adapter = createSapAdapter({
      tenantId: "demo",
      driver: "mock",
      mock: { unavailable: true },
    });
    expect((await adapter.health()).reachable).toBe(false);
  });

  it("refuses an ecc/s4 tenant with no connection settings", () => {
    expect(() => createSapAdapter({ tenantId: "t3", driver: "ecc" })).toThrow(/ECC connection/);
    expect(() => createSapAdapter({ tenantId: "t4", driver: "s4" })).toThrow(/S\/4 connection/);
  });

  it("fails loudly on a real driver rather than silently serving mock data", async () => {
    const adapter = createSapAdapter({
      tenantId: "t5",
      driver: "ecc",
      ecc: { endpoint: "wss://agent.example", client: "100", credentialsRef: "kms://t5/sap" },
    });
    expect(adapter.driver).toBe("ecc");
    await expect(adapter.getMaterials()).rejects.toSatisfy(
      (error: unknown) => isSapError(error) && error.kind === "not_implemented",
    );
  });
});
