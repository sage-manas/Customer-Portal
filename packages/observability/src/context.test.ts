import { describe, expect, it } from "vitest";

import { getContext, runWithContext, setContextTenant } from "./context";

describe("request context", () => {
  it("is undefined outside runWithContext", () => {
    expect(getContext()).toBeUndefined();
  });

  it("carries requestId through async work", async () => {
    await runWithContext({ requestId: "req-1" }, async () => {
      await Promise.resolve();
      expect(getContext()).toEqual({ requestId: "req-1" });
    });
  });

  it("setContextTenant mutates the active context in place", async () => {
    await runWithContext({ requestId: "req-2" }, async () => {
      setContextTenant("tenant-a", "user-1");
      expect(getContext()).toEqual({
        requestId: "req-2",
        tenantId: "tenant-a",
        userId: "user-1",
      });
    });
  });

  it("setContextTenant is a no-op outside a context", () => {
    expect(() => setContextTenant("tenant-a")).not.toThrow();
  });

  it("isolates concurrent contexts", async () => {
    const results: string[] = [];
    await Promise.all([
      runWithContext({ requestId: "a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(getContext()?.requestId ?? "?");
      }),
      runWithContext({ requestId: "b" }, async () => {
        results.push(getContext()?.requestId ?? "?");
      }),
    ]);
    expect(results.sort()).toEqual(["a", "b"]);
  });
});
