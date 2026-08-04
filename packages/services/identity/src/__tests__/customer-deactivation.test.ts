import { randomUUID } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { login, switchAccount } from "../identity-service";
import { hashPassword } from "../password";

/**
 * The teeth behind the tenant admin's deactivate button (ADR-057) — the
 * customer-level sibling of `tenant-deactivation.test.ts`, and here for the
 * same reason: `setCustomerAccountActive` in `@cc/service-customer` flips a
 * flag and deletes nothing, so the assertion that it *means* something has
 * to live where the consequence is enforced.
 *
 * Per ADR-024 the mechanism was broken on purpose: removing the
 * `activeCustomerKunnrs` filter from `login` fails the second test here by
 * name, and removing the re-check from `switchAccount` fails the fourth.
 */

const SECRET = "e".repeat(32);
const PASSWORD = "a very good customer password";

describe("login against a deactivated customer account", () => {
  const runId = randomUUID().slice(0, 8);
  const slug = `cust-deact-${runId}`;
  const email = `buyer-${runId}@deactivated.example`;
  const KUNNR_A = "0010001001";
  const KUNNR_B = "0010001002";
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const tenant = await db.tenant.create({ data: { slug, name: "Customer Deactivation Co" } });
    tenantId = tenant.id;

    const passwordHash = await hashPassword(PASSWORD);
    await runWithTenant(tenantId, async () => {
      const user = await db.user.create({
        data: { tenantId, email, roles: ["customer"], passwordHash },
      });
      userId = user.id;
      for (const sapKunnr of [KUNNR_A, KUNNR_B]) {
        await db.userAccountLink.create({ data: { tenantId, userId: user.id, sapKunnr } });
      }
    });
  });

  afterAll(async () => {
    await runWithTenant(tenantId, async () => {
      await db.userAccountLink.deleteMany();
      await db.user.deleteMany();
      await db.customerAccount.deleteMany();
    });
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await runWithTenant(tenantId, () => db.customerAccount.deleteMany());
  });

  async function deactivate(sapKunnr: string) {
    await runWithTenant(tenantId, () =>
      db.customerAccount.create({
        data: { tenantId, sapKunnr, isActive: false, deactivatedAt: new Date() },
      }),
    );
  }

  it("signs in with both accounts available while neither is deactivated", async () => {
    const result = await login({ email, password: PASSWORD, tenantSlug: slug }, SECRET);
    expect(result.session.availableKunnrs).toEqual([KUNNR_A, KUNNR_B]);
  });

  it("drops a deactivated account from the switcher but still signs the user in", async () => {
    await deactivate(KUNNR_A);

    const result = await login({ email, password: PASSWORD, tenantSlug: slug }, SECRET);
    expect(result.session.availableKunnrs).toEqual([KUNNR_B]);
    // The active account becomes the one they may actually use, rather than
    // a session pointed at an account it is refused everywhere.
    expect(result.session.kunnr).toBe(KUNNR_B);
  });

  it("refuses the login outright once every linked account is deactivated", async () => {
    await deactivate(KUNNR_A);
    await deactivate(KUNNR_B);

    await expect(
      login({ email, password: PASSWORD, tenantSlug: slug }, SECRET),
    ).rejects.toMatchObject({ code: "account_inactive", status: 403 });
  });

  it("refuses a switch to an account deactivated since the token was issued", async () => {
    const result = await login({ email, password: PASSWORD, tenantSlug: slug }, SECRET);
    // The claim still lists it — this is exactly the window the re-check
    // exists for.
    expect(result.session.availableKunnrs).toContain(KUNNR_B);

    await deactivate(KUNNR_B);

    await expect(switchAccount(result.session, KUNNR_B, SECRET)).rejects.toMatchObject({
      code: "account_inactive",
    });
    // The account that is still on remains switchable.
    await expect(switchAccount(result.session, KUNNR_A, SECRET)).resolves.toMatchObject({
      session: { kunnr: KUNNR_A },
    });
  });

  it("leaves a back-office user, who has no account links, entirely unaffected", async () => {
    await deactivate(KUNNR_A);
    await deactivate(KUNNR_B);

    const adminEmail = `admin-${runId}@deactivated.example`;
    await runWithTenant(tenantId, async () => {
      await db.user.create({
        data: {
          tenantId,
          email: adminEmail,
          roles: ["client_admin"],
          passwordHash: await hashPassword(PASSWORD),
        },
      });
    });

    const result = await login({ email: adminEmail, password: PASSWORD, tenantSlug: slug }, SECRET);
    expect(result.session.availableKunnrs).toEqual([]);
    expect(result.session.userId).not.toBe(userId);
  });
});
