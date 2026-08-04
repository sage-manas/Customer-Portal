import { randomUUID } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { operatorLogin } from "../operator-service";
import { hashPassword } from "../password";
import { getTenantHealth } from "../tenant-health";
import { createTenant, getTenant, listTenants } from "../tenant-provisioning";
import { getTenantUsage } from "../tenant-usage";

/**
 * The operator console's write and composed-read paths against a real
 * database (docs/07 B5): provisioning a tenant creates both the `Tenant`
 * row and its first `client_admin` login, health/usage are read per tenant
 * through `runWithTenant`, and an operator's own login is a wholly separate
 * table from `User` (docs/DECISIONS.md ADR-045).
 */

const SECRET = "c".repeat(32);

describe("platform provisioning + composed reads", () => {
  const runId = randomUUID().slice(0, 8);
  const createdTenantIds: string[] = [];

  async function wipe() {
    if (createdTenantIds.length === 0) return;
    for (const tenantId of createdTenantIds) {
      await runWithTenant(tenantId, () =>
        Promise.all([db.user.deleteMany(), db.outboxEvent.deleteMany()]),
      );
    }
    await db.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    createdTenantIds.length = 0;
  }

  afterAll(async () => {
    await wipe();
    await db.operator.deleteMany({ where: { email: { contains: runId } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  it("provisions a tenant with its first client_admin, refusing a duplicate slug", async () => {
    const slug = `ops-${runId}`;
    const result = await createTenant({
      slug,
      name: "Acme Test Co",
      adminEmail: `admin-${runId}@acme.example`,
    });
    createdTenantIds.push(result.tenantId);

    expect(result.temporaryPassword.length).toBeGreaterThan(10);

    const adminUser = await runWithTenant(result.tenantId, () =>
      db.user.findUniqueOrThrow({ where: { id: result.adminUserId } }),
    );
    expect(adminUser.roles).toEqual(["client_admin"]);
    expect(adminUser.mustChangePassword).toBe(true);

    const listed = await listTenants();
    expect(listed.some((t) => t.id === result.tenantId)).toBe(true);

    const fetched = await getTenant(result.tenantId);
    expect(fetched?.slug).toBe(slug);

    await expect(
      createTenant({ slug, name: "Duplicate", adminEmail: `dup-${runId}@acme.example` }),
    ).rejects.toThrow("tenant_slug_taken");
  });

  it("composes health and usage per tenant without storing either", async () => {
    const result = await createTenant({
      slug: `ops-health-${runId}`,
      name: "Health Test Co",
      adminEmail: `health-${runId}@acme.example`,
    });
    createdTenantIds.push(result.tenantId);

    await runWithTenant(result.tenantId, () =>
      db.outboxEvent.create({
        data: {
          tenantId: result.tenantId,
          eventName: "payment.captured",
          payload: { occurredAt: new Date().toISOString(), paymentId: "pay_1" },
          queue: "payments",
          dedupeKey: randomUUID(),
          state: "pending",
        },
      }),
    );

    const health = await getTenantHealth(result.tenantId);
    expect(health.sapDriver).toBe("mock");
    expect(health.sapConnectivity).toBe("mock_ok");
    expect(health.outboxPending).toBe(1);
    expect(health.outboxFailed).toBe(0);

    const usage = await getTenantUsage(result.tenantId);
    expect(usage.userCount).toBe(1); // the provisioned client_admin
  });

  it("operator login is a separate table from tenant Users entirely", async () => {
    const email = `operator-${runId}@platform.example`;
    const passwordHash = await hashPassword("a very good operator password");
    // `roles` has no schema default (ADR-049) — creating an operator states
    // what it may do, so forgetting the field is a write error rather than a
    // login that silently reaches nothing.
    await db.operator.create({ data: { email, passwordHash, roles: ["sap_manager"] } });

    const { claims } = await operatorLogin(email, "a very good operator password", SECRET);
    expect(claims.email).toBe(email);

    await expect(operatorLogin(email, "wrong password", SECRET)).rejects.toThrow(
      "invalid_credentials",
    );
  });
});
