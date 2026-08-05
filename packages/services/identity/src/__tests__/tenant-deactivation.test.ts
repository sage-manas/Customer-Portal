import { randomUUID } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findTenantBySlug, login } from "../identity-service";
import { hashPassword } from "../password";

/**
 * The teeth behind the operator console's deactivate button (ADR-054).
 *
 * `setTenantActive` in `@cc/service-platform` flips a flag and deletes
 * nothing; on its own that is a column nobody reads. This is the assertion
 * that makes it a control — and it lives here rather than beside that
 * function because refusing a sign-in is identity's decision, and a service
 * may not import another service to make somebody else's (rule 1).
 */

const SECRET = "d".repeat(32);
const PASSWORD = "a very good tenant password";

describe("login against a deactivated tenant", () => {
  const runId = randomUUID().slice(0, 8);
  const slug = `deactivated-${runId}`;
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await db.tenant.create({ data: { slug, name: "Deactivation Test Co" } });
    tenantId = tenant.id;

    const passwordHash = await hashPassword(PASSWORD);
    await runWithTenant(tenantId, () =>
      db.user.create({
        data: {
          tenantId,
          email: `buyer-${runId}@deactivated.example`,
          roles: ["customer"],
          passwordHash,
        },
      }),
    );
  });

  afterAll(async () => {
    await runWithTenant(tenantId, () => db.user.deleteMany());
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.$disconnect();
  });

  it("signs in normally while the tenant is active", async () => {
    const result = await login(
      { email: `buyer-${runId}@deactivated.example`, password: PASSWORD, tenantSlug: slug },
      SECRET,
    );
    expect(result.session.tenantId).toBe(tenantId);
    expect(result.tenant.isActive).toBe(true);
  });

  it("refuses every login once the tenant is deactivated, with correct credentials", async () => {
    await db.tenant.update({
      where: { id: tenantId },
      data: { isActive: false, deactivatedAt: new Date() },
    });

    // Correct password, existing user, right host — and still refused. The
    // check sits above the credential path deliberately: the answer does
    // not depend on the password, and there is nothing to conceal from
    // somebody who already knows this portal exists.
    await expect(
      login(
        { email: `buyer-${runId}@deactivated.example`, password: PASSWORD, tenantSlug: slug },
        SECRET,
      ),
    ).rejects.toMatchObject({ code: "tenant_inactive", status: 403 });

    // Nothing was deleted — the other half of ADR-054's promise.
    expect(await runWithTenant(tenantId, () => db.user.count())).toBe(1);
  });

  it("resolves the tenant either way, so a screen can say why", async () => {
    const tenant = await findTenantBySlug(slug);
    expect(tenant?.isActive).toBe(false);
  });

  it("signs in again the moment it is reactivated, with nothing to restore", async () => {
    await db.tenant.update({
      where: { id: tenantId },
      data: { isActive: true, deactivatedAt: null },
    });

    const result = await login(
      { email: `buyer-${runId}@deactivated.example`, password: PASSWORD, tenantSlug: slug },
      SECRET,
    );
    expect(result.session.tenantId).toBe(tenantId);
  });
});
