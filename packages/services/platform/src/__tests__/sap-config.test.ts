import { randomUUID } from "node:crypto";

import { db, getTenantCredential, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOperator, listOperators, setOperatorActive } from "../operator-admin";
import { listSapConfigAudit } from "../sap-config-audit";
import { setTenantActive } from "../tenant-admin";
import { createTenant } from "../tenant-provisioning";
import { getTenantSapConfig, testSapConnection, updateTenantSapConfig } from "../tenant-sap-config";

/**
 * Phase 4's write paths against a real database: the SAP configuration
 * screen's round trip through the envelope-encryption vault, the trail it
 * appends to, tenant deactivation, and operator management.
 *
 * The assertions that matter most here are the negative ones — that a
 * secret does not come back out, and that the trail holds no values — since
 * those are properties nothing in the type system enforces.
 */

/** As `updateTenantSapConfig` takes it (the trail keeps the address as it
 * was at the time, so it is a field rather than a lookup). */
const OPERATOR = { operatorId: "op_test", operatorEmail: "operator@platform.example" };
/** As `testSapConnection` takes it — the shape `requireOperator` returns. */
const OPERATOR_CLAIMS = { operatorId: "op_test", email: "operator@platform.example" };

describe("per-tenant SAP configuration", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantId: string;

  beforeAll(async () => {
    const created = await createTenant({
      slug: `sapcfg-${runId}`,
      name: "SAP Config Test Co",
      adminEmail: `admin-${runId}@sapcfg.example`,
    });
    tenantId = created.tenantId;
  });

  afterAll(async () => {
    await runWithTenant(tenantId, async () => {
      await db.sapConfigAudit.deleteMany();
      await db.tenantCredential.deleteMany();
      await db.tenantDataKey.deleteMany();
      await db.user.deleteMany();
    });
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.operator.deleteMany({ where: { email: { contains: runId } } });
    await db.$disconnect();
  });

  it("starts on mock with nothing to configure", async () => {
    const config = await getTenantSapConfig(tenantId);
    expect(config.driver).toBe("mock");
    expect(config.fields).toEqual([]);
    expect(config.missing).toEqual([]);
  });

  it("stores an ECC connection encrypted, and never reads the secret back", async () => {
    const result = await updateTenantSapConfig({
      tenantId,
      driver: "ecc",
      params: {
        endpoint: "sap.example:3300",
        client: "100",
        user: "PORTAL_RFC",
        password: "the-rfc-password",
      },
      ...OPERATOR,
    });

    expect(result.driverChanged).toBe(true);
    expect(result.changedFields.sort()).toEqual(["client", "endpoint", "password", "user"]);
    expect(result.missing).toEqual([]);

    const config = await getTenantSapConfig(tenantId);
    const byKey = new Map(config.fields.map((field) => [field.key, field]));

    // The non-secret target is visible — an operator has to be able to see
    // what a tenant points at.
    expect(byKey.get("endpoint")?.value).toBe("sap.example:3300");
    // The secret is not, in any form. `isSet` is the entire disclosure.
    expect(byKey.get("password")?.value).toBeNull();
    expect(byKey.get("password")?.isSet).toBe(true);
    expect(JSON.stringify(config)).not.toContain("the-rfc-password");

    // ...but it really is stored, and decrypts through the vault.
    const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
    expect(stored?.password).toBe("the-rfc-password");

    // ...and ciphertext is what actually sits in the table (ADR-042).
    const row = await runWithTenant(tenantId, () =>
      db.tenantCredential.findFirstOrThrow({ where: { system: "sap" } }),
    );
    expect(row.ciphertext).not.toContain("the-rfc-password");
  });

  it("keeps an omitted secret and updates the field beside it", async () => {
    const result = await updateTenantSapConfig({
      tenantId,
      driver: "ecc",
      params: { endpoint: "sap-new.example:3300", client: "100", user: "PORTAL_RFC", password: "" },
      ...OPERATOR,
    });

    // The whole point of the write-only secret: an endpoint typo is fixable
    // without anybody knowing the password.
    expect(result.changedFields).toEqual(["endpoint"]);
    const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
    expect(stored?.password).toBe("the-rfc-password");
  });

  it("clears a secret only when asked explicitly", async () => {
    await updateTenantSapConfig({
      tenantId,
      driver: "ecc",
      params: { endpoint: "sap-new.example:3300", client: "100", user: "PORTAL_RFC" },
      clearSecrets: ["password"],
      ...OPERATOR,
    });

    const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
    expect(stored?.password).toBeUndefined();

    const config = await getTenantSapConfig(tenantId);
    expect(config.missing).toEqual(["password"]);
  });

  it("drops parameters the new driver has no use for", async () => {
    await updateTenantSapConfig({
      tenantId,
      driver: "s4",
      params: { baseUrl: "https://s4.example/sap/opu/odata", user: "PORTAL_ODATA" },
      ...OPERATOR,
    });

    const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
    // `endpoint` and `systemNumber` are ECC-only: leaving them behind would
    // make the trail's diffs meaningless and the vault a museum.
    expect(stored).not.toHaveProperty("endpoint");
    expect(stored).not.toHaveProperty("systemNumber");
    expect(stored?.baseUrl).toBe("https://s4.example/sap/opu/odata");
  });

  it("clears the stored connection entirely when switched back to mock", async () => {
    await updateTenantSapConfig({ tenantId, driver: "mock", params: {}, ...OPERATOR });

    const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
    expect(stored).toBeNull();

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.sapDriver).toBe("mock");
  });

  it("records a connection test without throwing, whatever the adapter does", async () => {
    const reachable = await testSapConnection(
      tenantId,
      {
        health: async () => ({
          reachable: true,
          driver: "mock",
          circuit: "closed" as const,
          checkedAt: new Date().toISOString(),
        }),
      },
      OPERATOR_CLAIMS,
    );
    expect(reachable.reachable).toBe(true);

    // A driver that throws is an answer, not a 500: `not_implemented` from
    // an uncertified ecc/s4 driver (ADR-006) is exactly what an operator
    // configuring one needs told.
    const failed = await testSapConnection(
      tenantId,
      {
        health: async () => {
          throw new Error("not_implemented");
        },
      },
      OPERATOR_CLAIMS,
    );
    expect(failed.reachable).toBe(false);
    expect(failed.error).toBe("not_implemented");
  });

  it("keeps an append-only trail of field names and never of values", async () => {
    const trail = await listSapConfigAudit(tenantId);

    // Newest first, and every write above is represented.
    expect(trail.length).toBeGreaterThanOrEqual(6);
    expect(trail.map((entry) => entry.action)).toContain("driver.changed");
    expect(trail.map((entry) => entry.action)).toContain("connection.updated");
    expect(trail.map((entry) => entry.action)).toContain("connection.tested");

    const serialised = JSON.stringify(trail);
    expect(serialised).not.toContain("the-rfc-password");
    expect(serialised).toContain("endpoint"); // the *name* is recorded

    // Ordering is what makes "when did this tenant stop working?" answerable.
    const timestamps = trail.map((entry) => entry.createdAt.getTime());
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });
});

describe("tenant deactivation", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantId: string;

  beforeAll(async () => {
    const created = await createTenant({
      slug: `deact-${runId}`,
      name: "Deactivation Test Co",
      adminEmail: `admin-${runId}@deact.example`,
    });
    tenantId = created.tenantId;
  });

  afterAll(async () => {
    await runWithTenant(tenantId, () => db.user.deleteMany());
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.$disconnect();
  });

  it("is soft, reversible, and deletes nothing", async () => {
    const before = await runWithTenant(tenantId, () => db.user.count());

    const deactivated = await setTenantActive(tenantId, false);
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.deactivatedAt).toBeInstanceOf(Date);

    // The consequence the console's dialog names: nothing the tenant owns
    // is touched. `login` is what refuses them (@cc/service-identity).
    expect(await runWithTenant(tenantId, () => db.user.count())).toBe(before);

    const reactivated = await setTenantActive(tenantId, true);
    expect(reactivated.isActive).toBe(true);
    expect(reactivated.deactivatedAt).toBeNull();
  });
});

describe("operator management", () => {
  const runId = randomUUID().slice(0, 8);
  const createdIds: string[] = [];

  afterAll(async () => {
    await db.operator.deleteMany({ where: { id: { in: createdIds } } });
    await db.$disconnect();
  });

  it("issues a one-time password and refuses a duplicate address", async () => {
    const email = `new-op-${runId}@platform.example`;
    const { operator, temporaryPassword } = await createOperator({
      email,
      roles: ["sap_manager"],
    });
    createdIds.push(operator.id);

    expect(operator.roles).toEqual(["sap_manager"]);
    expect(operator.mustChangePassword).toBe(true);
    expect(temporaryPassword.length).toBeGreaterThan(10);

    expect((await listOperators()).some((row) => row.id === operator.id)).toBe(true);

    await expect(createOperator({ email, roles: ["super_admin"] })).rejects.toMatchObject({
      code: "operator_email_taken",
    });
  });

  it("refuses a tenant role outright rather than storing one that means nothing", async () => {
    // `Role` spans all three planes by design (one registry, CLAUDE.md rule
    // 3), so `client_admin` type-checks here — which is exactly why the
    // refusal has to be a runtime one. The roles arrive as JSON from a form
    // in any case, where the type guarantees nothing at all.
    await expect(
      createOperator({ email: `tenant-role-${runId}@platform.example`, roles: ["client_admin"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("will not let an operator deactivate themselves", async () => {
    const { operator } = await createOperator({
      email: `self-${runId}@platform.example`,
      roles: ["super_admin"],
    });
    createdIds.push(operator.id);

    await expect(setOperatorActive(operator.id, false, operator.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
