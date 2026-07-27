import { afterEach, describe, expect, it } from "vitest";

import { createGstnAdapter, resetGstnAdapter } from "./factory";
import { MockGstnAdapter } from "./mock/driver";


afterEach(() => resetGstnAdapter());

describe("createGstnAdapter", () => {
  it("builds the mock driver and caches it per tenant", () => {
    const first = createGstnAdapter({ tenantId: "t1", driver: "mock" });
    const second = createGstnAdapter({ tenantId: "t1", driver: "mock" });

    expect(first).toBeInstanceOf(MockGstnAdapter);
    expect(second).toBe(first);
  });

  it("gives each tenant its own instance", () => {
    expect(createGstnAdapter({ tenantId: "t1", driver: "mock" })).not.toBe(
      createGstnAdapter({ tenantId: "t2", driver: "mock" }),
    );
  });

  it("refuses the api driver without connection settings instead of falling back to mock", () => {
    expect(() => createGstnAdapter({ tenantId: "t1", driver: "api" })).toThrow(
      /no connection settings/,
    );
  });

  it("builds the api driver when configured — and it fails loudly, per ADR-006", async () => {
    const adapter = createGstnAdapter({
      tenantId: "t1",
      driver: "api",
      api: { baseUrl: "https://gstn.example", credentialsRef: "kms://t1/gstn" },
    });

    expect(adapter.driver).toBe("api");
    await expect(adapter.verifyGstin("27AAPFU0939F1ZV")).rejects.toMatchObject({
      kind: "not_implemented",
    });
  });

  it("drops only the named tenant's cached adapter on reset", () => {
    const t1 = createGstnAdapter({ tenantId: "t1", driver: "mock" });
    const t2 = createGstnAdapter({ tenantId: "t2", driver: "mock" });

    resetGstnAdapter("t1");

    expect(createGstnAdapter({ tenantId: "t1", driver: "mock" })).not.toBe(t1);
    expect(createGstnAdapter({ tenantId: "t2", driver: "mock" })).toBe(t2);
  });
});
