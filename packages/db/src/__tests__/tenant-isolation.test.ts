import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getTenantId, runWithTenant } from "../index";

/**
 * Cross-tenant isolation tests (docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md:
 * "Include automated cross-tenant isolation tests in CI"). Requires a real
 * Postgres reachable via DATABASE_URL — see packages/db/README.md.
 */
describe("tenant isolation", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  function createUser(tenantId: string, email: string) {
    // tenantId is passed to satisfy Prisma's static create-input type; the
    // middleware overwrites it with the bound context regardless (see
    // tenant-middleware.ts) — proven by the "middleware overrides a
    // mismatched tenantId" test below.
    return db.user.create({ data: { tenantId, email, roles: ["buyer_admin"] } });
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({
      data: { slug: `tenant-a-${runId}`, name: "Tenant A" },
    });
    tenantB = await db.tenant.create({
      data: { slug: `tenant-b-${runId}`, name: "Tenant B" },
    });
  });

  afterAll(async () => {
    await runWithTenant(tenantA.id, () => db.user.deleteMany());
    await runWithTenant(tenantB.id, () => db.user.deleteMany());
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  it("throws when a query runs with no tenant context bound", async () => {
    await expect(db.user.findMany()).rejects.toThrow(/No tenant context bound/);
  });

  it("getTenantId throws outside runWithTenant", () => {
    expect(() => getTenantId()).toThrow(/No tenant context bound/);
  });

  it("scopes writes: a user created for tenant A carries tenant A's id", async () => {
    const user = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a-${runId}@example.com`),
    );
    expect(user.tenantId).toBe(tenantA.id);
  });

  it("the middleware overrides a mismatched tenantId with the bound context", async () => {
    // Caller claims tenant B in `data`, but the bound context is tenant A —
    // the context must win, proving scoping can't be spoofed via `data`.
    const user = await runWithTenant(tenantA.id, () =>
      createUser(tenantB.id, `spoof-${runId}@example.com`),
    );
    expect(user.tenantId).toBe(tenantA.id);
  });

  it("tenant B cannot read tenant A's user by id (findUnique returns null, never leaks)", async () => {
    const userA = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a2-${runId}@example.com`),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.user.findUnique({ where: { id: userA.id } }),
    );

    expect(asSeenByTenantB).toBeNull();
  });

  it("tenant B's findMany never includes tenant A's rows", async () => {
    await runWithTenant(tenantA.id, () => createUser(tenantA.id, `a3-${runId}@example.com`));
    await runWithTenant(tenantB.id, () => createUser(tenantB.id, `b-${runId}@example.com`));

    const tenantBUsers = await runWithTenant(tenantB.id, () => db.user.findMany());

    expect(tenantBUsers.length).toBeGreaterThan(0);
    expect(tenantBUsers.every((u) => u.tenantId === tenantB.id)).toBe(true);
  });

  it("a wrong-tenant update affects zero rows instead of the other tenant's row", async () => {
    const userA = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a4-${runId}@example.com`),
    );

    const result = await runWithTenant(tenantB.id, () =>
      db.user.updateMany({
        where: { id: userA.id },
        data: { roles: ["tenant_admin"] },
      }),
    );

    expect(result.count).toBe(0);
  });
});
