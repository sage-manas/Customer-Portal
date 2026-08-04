import { randomUUID } from "node:crypto";

import { MockSapAdapter } from "@cc/adapter-sap";
import { db, isCustomerAccountActive, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertCustomerCanOrder,
  getCustomerAccount,
  listCustomerAccounts,
  registerCustomerAccount,
  setCustomerAccountActive,
  updateCustomerAccount,
} from "../customer-service";

/**
 * The customer directory against a real database and the mock SAP driver
 * (ADR-057).
 *
 * Per ADR-024 the mechanisms here were broken on purpose while writing this:
 * deleting the `loadAccount` call in `updateCustomerAccount` fails
 * "404s a KUNNR this tenant has no account row for", and making
 * `isCustomerAccountActive` default to `true` for a deactivated row fails
 * the ordering test below. A flag nothing reads is a column, not a control.
 */

/** A KUNNR the mock's seed data knows about. */
const SEEDED_KUNNR = "0010001001";
const ADMIN = "client-admin-user-id";

function sap() {
  return new MockSapAdapter();
}

describe("customer directory", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `cust-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `cust-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.userAccountLink.deleteMany();
        await db.user.deleteMany();
        await db.customerAccount.deleteMany();
        await db.auditLog.deleteMany();
      });
    }
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.userAccountLink.deleteMany();
        await db.user.deleteMany();
        await db.customerAccount.deleteMany();
        await db.auditLog.deleteMany();
      });
    }
  });

  it("composes the SAP master with the portal's own access row", async () => {
    await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });

    const read = await listCustomerAccounts(tenantA.id, sap());
    expect(read.data).toHaveLength(1);

    const [summary] = read.data;
    expect(summary?.kunnr).toBe(SEEDED_KUNNR);
    // Nothing about the name or GSTIN is stored — both came from SAP on this
    // request, which is why the list carries a freshness at all.
    expect(summary?.legalEntityName.length).toBeGreaterThan(0);
    expect(summary?.gstin).toBeTruthy();
    expect(read.freshness).toBe("live");
    expect(summary?.status).toBe("Active");
    expect(summary?.origin).toBe("self_registered");
  });

  it("records provenance when the back office registered the customer", async () => {
    await registerCustomerAccount(tenantA.id, {
      kunnr: SEEDED_KUNNR,
      registeredByUserId: ADMIN,
      onboardingApplicationId: "app-1",
    });

    const detail = await getCustomerAccount(tenantA.id, SEEDED_KUNNR, sap());
    expect(detail.summary.origin).toBe("back_office");
    expect(detail.registeredByUserId).toBe(ADMIN);
    expect(detail.onboardingApplicationId).toBe("app-1");
  });

  it("keeps the first registration's provenance and access decision on a repeat", async () => {
    await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR, registeredByUserId: ADMIN });
    await setCustomerAccountActive(tenantA.id, SEEDED_KUNNR, {
      isActive: false,
      actorUserId: ADMIN,
    });

    // Approving a second sold-to for the same company must not fail, and
    // must not silently reactivate an account somebody switched off.
    await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });

    const detail = await getCustomerAccount(tenantA.id, SEEDED_KUNNR, sap());
    expect(detail.summary.status).toBe("Deactivated");
    expect(detail.registeredByUserId).toBe(ADMIN);
  });

  it("counts the logins linked to the account", async () => {
    await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });
    await runWithTenant(tenantA.id, async () => {
      const user = await db.user.create({
        data: {
          tenantId: tenantA.id,
          email: `buyer-${runId}@example.test`,
          roles: ["customer"],
          passwordHash: "unused",
        },
      });
      await db.userAccountLink.create({
        data: { tenantId: tenantA.id, userId: user.id, sapKunnr: SEEDED_KUNNR },
      });
    });

    const detail = await getCustomerAccount(tenantA.id, SEEDED_KUNNR, sap());
    expect(detail.summary.userCount).toBe(1);
    expect(detail.users).toHaveLength(1);
  });

  it("answers 404 for another tenant's customer", async () => {
    await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });

    // Tenant B can read this KUNNR from SAP perfectly well — the boundary is
    // the portal's account row, and the answer is indistinguishable from a
    // customer that never existed (CLAUDE.md rule 5).
    await expect(getCustomerAccount(tenantB.id, SEEDED_KUNNR, sap())).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect((await listCustomerAccounts(tenantB.id, sap())).data).toHaveLength(0);
  });

  describe("editing", () => {
    const VALID_EDIT = {
      tradeName: "Acme Trading",
      street: "9 New Road",
      city: "Nashik",
      state: "27",
      pinCode: "422001",
      country: "IN",
      contactPerson: "R Sharma",
      email: "ap@acme.example",
      phone: "9876543210",
    };

    it("writes the master through SAP and records the field names it changed", async () => {
      await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });
      const adapter = sap();

      const updated = await updateCustomerAccount(
        tenantA.id,
        SEEDED_KUNNR,
        VALID_EDIT,
        adapter,
        ADMIN,
      );
      expect(updated.address.city).toBe("Nashik");
      expect(updated.contact.email).toBe("ap@acme.example");

      const read = await adapter.getCustomer(SEEDED_KUNNR);
      expect(read.data.address.city).toBe("Nashik");

      const audits = await runWithTenant(tenantA.id, () =>
        db.auditLog.findMany({ where: { entityId: SEEDED_KUNNR } }),
      );
      const entry = audits.find((row) => row.action === "customer.updated");
      // Names, never values: an audit row is not a second copy of the
      // customer master (the reasoning of ADR-053).
      expect(entry?.metadata).toMatchObject({ changedFields: expect.any(Array) });
      expect(JSON.stringify(entry?.metadata)).not.toContain("Nashik");
    });

    it("refuses an edit that the wizard's own field rules would refuse", async () => {
      await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });

      await expect(
        updateCustomerAccount(
          tenantA.id,
          SEEDED_KUNNR,
          { ...VALID_EDIT, email: "not-an-email" },
          sap(),
          ADMIN,
        ),
      ).rejects.toMatchObject({ code: "invalid", status: 422 });
    });

    it("404s a KUNNR this tenant has no account row for, without reaching SAP", async () => {
      await expect(
        updateCustomerAccount(tenantB.id, SEEDED_KUNNR, VALID_EDIT, sap(), ADMIN),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("deactivation", () => {
    it("blocks new orders, keeps everything else, and reverses cleanly", async () => {
      await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });
      await expect(assertCustomerCanOrder(tenantA.id, SEEDED_KUNNR)).resolves.toBeUndefined();

      const deactivated = await setCustomerAccountActive(tenantA.id, SEEDED_KUNNR, {
        isActive: false,
        reason: "Left the group",
        actorUserId: ADMIN,
      });
      expect(deactivated.status).toBe("Deactivated");
      expect(deactivated.deactivationReason).toBe("Left the group");

      await expect(assertCustomerCanOrder(tenantA.id, SEEDED_KUNNR)).rejects.toMatchObject({
        code: "conflict",
      });
      expect(await runWithTenant(tenantA.id, () => isCustomerAccountActive(SEEDED_KUNNR))).toBe(
        false,
      );

      // Nothing was deleted, and reactivation clears the trail's "currently
      // off" fields while leaving the account itself untouched.
      const reactivated = await setCustomerAccountActive(tenantA.id, SEEDED_KUNNR, {
        isActive: true,
        actorUserId: ADMIN,
      });
      expect(reactivated.status).toBe("Active");
      expect(reactivated.deactivatedAt).toBeUndefined();
      await expect(assertCustomerCanOrder(tenantA.id, SEEDED_KUNNR)).resolves.toBeUndefined();
    });

    it("treats an account with no row at all as active", async () => {
      // Accounts that predate the portal, or were created in SAP directly,
      // have never had a decision taken about them. Defaulting them to
      // blocked would lock out every customer the portal did not register.
      expect(await runWithTenant(tenantA.id, () => isCustomerAccountActive("0010009999"))).toBe(
        true,
      );
      await expect(assertCustomerCanOrder(tenantA.id, "0010009999")).resolves.toBeUndefined();
    });

    it("filters the directory by access state", async () => {
      await registerCustomerAccount(tenantA.id, { kunnr: SEEDED_KUNNR });
      await registerCustomerAccount(tenantA.id, { kunnr: "0010001002" });
      await setCustomerAccountActive(tenantA.id, SEEDED_KUNNR, {
        isActive: false,
        actorUserId: ADMIN,
      });

      const active = await listCustomerAccounts(tenantA.id, sap(), { status: "Active" });
      expect(active.data.map((row) => row.kunnr)).toEqual(["0010001002"]);

      const off = await listCustomerAccounts(tenantA.id, sap(), { status: "Deactivated" });
      expect(off.data.map((row) => row.kunnr)).toEqual([SEEDED_KUNNR]);
    });
  });
});
