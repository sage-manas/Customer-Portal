import { describe, expect, it } from "vitest";

import { createBillingAdapter } from "../factory";

describe("MockBillingAdapter", () => {
  it("returns the stub plan labelled as mock-sourced", async () => {
    const adapter = createBillingAdapter();
    const plan = await adapter.getPlanForTenant("tenant-1");
    expect(plan).toEqual({ plan: "starter", seatLimit: 10, source: "mock" });
  });

  it("gives the same answer regardless of tenant, honestly (it's a stub)", async () => {
    const adapter = createBillingAdapter();
    const [a, b] = await Promise.all([
      adapter.getPlanForTenant("tenant-1"),
      adapter.getPlanForTenant("tenant-2"),
    ]);
    expect(a).toEqual(b);
  });
});
