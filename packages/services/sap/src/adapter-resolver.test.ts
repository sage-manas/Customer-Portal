import { beforeEach, describe, expect, it, vi } from "vitest";

const getTenantCredential = vi.fn();

vi.mock("@cc/db", () => ({
  db: { tenant: { findUnique: vi.fn() } },
  getTenantCredential,
  // Real `runWithTenant` binds AsyncLocalStorage context; the resolver only
  // needs *a* promise-returning wrapper here, since `getTenantCredential`
  // itself is mocked and doesn't read the ambient context.
  runWithTenant: (_tenantId: string, fn: () => unknown) => Promise.resolve(fn()),
}));

const { db } = await import("@cc/db");
const { getSapAdapterForTenant } = await import("./adapter-resolver");

// The Prisma client is mocked, so this is deliberately not typed against it.
const findUnique = db.tenant.findUnique as unknown as ReturnType<typeof vi.fn>;

/**
 * A6 moved `getDashboardSummary` out of this package into
 * `@cc/service-reporting`, which left the resolver — the package's actual
 * job, and the reason `apps` never imports `@cc/adapter-sap` — with no test
 * at all. These cover the two things a route handler depends on.
 */
describe("getSapAdapterForTenant", () => {
  beforeEach(() => {
    findUnique.mockReset();
    getTenantCredential.mockReset();
  });

  it("resolves the driver the tenant is configured for", async () => {
    findUnique.mockResolvedValue({ id: "t1", slug: "acme", sapDriver: "mock" });
    const adapter = await getSapAdapterForTenant("t1");
    expect(adapter.driver).toBe("mock");
  });

  it("refuses an unknown tenant rather than falling back to a default", async () => {
    // Silently handing back a mock adapter for a tenant that does not exist
    // would make a misrouted subdomain look like a working portal.
    findUnique.mockResolvedValue(null);
    await expect(getSapAdapterForTenant("nope")).rejects.toThrow(/Unknown tenant/);
  });

  it("never touches the credential vault for a mock-driver tenant", async () => {
    findUnique.mockResolvedValue({ id: "t1", slug: "acme", sapDriver: "mock" });
    await getSapAdapterForTenant("t1");
    expect(getTenantCredential).not.toHaveBeenCalled();
  });

  it("threads the vault's decrypted credential into the ecc driver config (ADR-042)", async () => {
    findUnique.mockResolvedValue({ id: "t2", slug: "ecc-tenant", sapDriver: "ecc" });
    getTenantCredential.mockResolvedValue({ username: "svc", password: "s3cr3t" });

    const adapter = await getSapAdapterForTenant("t2");

    expect(getTenantCredential).toHaveBeenCalledWith("t2", "sap");
    expect((adapter as { config?: { credentials?: unknown } }).config?.credentials).toEqual({
      username: "svc",
      password: "s3cr3t",
    });
  });
});
