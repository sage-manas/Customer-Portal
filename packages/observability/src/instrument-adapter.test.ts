import { describe, expect, it, vi } from "vitest";

import { instrumentAdapter } from "./instrument-adapter";

interface FakeAdapter {
  readonly driver: string;
  getOrders(kunnr: string): Promise<string[]>;
  health(): { ok: boolean };
}

function fakeAdapter(overrides: Partial<FakeAdapter> = {}): FakeAdapter {
  return {
    driver: "mock",
    getOrders: vi.fn(async (kunnr: string) => [`order-for-${kunnr}`]),
    health: vi.fn(() => ({ ok: true })),
    ...overrides,
  };
}

describe("instrumentAdapter", () => {
  it("forwards method calls and their return value through the proxy", async () => {
    const adapter = fakeAdapter();
    const instrumented = instrumentAdapter("sap", adapter, { tenantId: "tenant-1" });

    await expect(instrumented.getOrders("1000")).resolves.toEqual(["order-for-1000"]);
    expect(adapter.getOrders).toHaveBeenCalledWith("1000");
  });

  it("forwards synchronous method calls too", () => {
    const adapter = fakeAdapter();
    const instrumented = instrumentAdapter("sap", adapter, { tenantId: "tenant-1" });

    expect(instrumented.health()).toEqual({ ok: true });
  });

  it("re-throws a rejected promise from the wrapped method", async () => {
    const adapter = fakeAdapter({
      getOrders: vi.fn(async () => {
        throw new Error("SAP unreachable");
      }),
    });
    const instrumented = instrumentAdapter("sap", adapter, { tenantId: "tenant-1" });

    await expect(instrumented.getOrders("1000")).rejects.toThrow("SAP unreachable");
  });

  it("passes non-function properties through unchanged", () => {
    const adapter = fakeAdapter();
    const instrumented = instrumentAdapter("sap", adapter, { tenantId: "tenant-1" });

    expect(instrumented.driver).toBe("mock");
  });
});
