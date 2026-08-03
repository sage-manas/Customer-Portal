import { db, runWithTenant } from "@cc/db";
import type { Role } from "@cc/domain";

import { hashPassword } from "../src/password";

/**
 * Development seed: two tenants on the mock SAP driver, with users covering
 * every role family and account links to the KUNNRs the mock adapter seeds
 * (`SEED_CUSTOMERS` in @cc/adapter-sap).
 *
 * It lives in this package rather than `@cc/db` because it writes
 * credentials, and the hashing format belongs to the identity service — the
 * dependency rule (`db -> domain, config`) would be violated by `@cc/db`
 * importing it, and hand-copying the hash format into the seed is exactly
 * the duplication CLAUDE.md rule 3 forbids.
 *
 * Two tenants, not one, on purpose: cross-tenant isolation is only
 * demonstrable when a second tenant's data exists to fail to reach.
 * Idempotent — safe to re-run. Refuses to touch a production database.
 */

const DEV_PASSWORD = "portal-dev-password";

interface SeedUser {
  email: string;
  roles: Role[];
  kunnrs: string[];
}

async function seedTenantUsers(tenantId: string, passwordHash: string, users: SeedUser[]) {
  // Every write goes through the tenant context, exactly as a request would
  // — the seed gets no privileged path around scoping.
  await runWithTenant(tenantId, async () => {
    for (const user of users) {
      const record = await db.user.upsert({
        where: { tenantId_email: { tenantId, email: user.email } },
        update: { roles: user.roles, passwordHash },
        create: { tenantId, email: user.email, roles: user.roles, passwordHash },
      });

      for (const sapKunnr of user.kunnrs) {
        await db.userAccountLink.upsert({
          where: { tenantId_userId_sapKunnr: { tenantId, userId: record.id, sapKunnr } },
          update: {},
          create: { tenantId, userId: record.id, sapKunnr },
        });
      }
    }
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const acme = await db.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      slug: "acme",
      name: "Acme Industrials",
      sapDriver: "mock",
      primaryColor: "#5b21b6",
      moduleToggles: {},
    },
  });

  const globex = await db.tenant.upsert({
    where: { slug: "globex" },
    update: {},
    create: {
      slug: "globex",
      name: "Globex Manufacturing",
      sapDriver: "mock",
      // Globex bought the portal without the loyalty/account module.
      moduleToggles: { account: false },
    },
  });

  await seedTenantUsers(acme.id, passwordHash, [
    { email: "buyer@acme.example", roles: ["customer"], kunnrs: ["0010001001"] },
    { email: "multi@acme.example", roles: ["customer"], kunnrs: ["0010001001", "0010001002"] },
    { email: "admin@acme.example", roles: ["client_admin"], kunnrs: [] },
    { email: "ap@acme.example", roles: ["ap_manager"], kunnrs: [] },
    { email: "ar@acme.example", roles: ["ar_manager"], kunnrs: [] },
  ]);

  await seedTenantUsers(globex.id, passwordHash, [
    { email: "buyer@globex.example", roles: ["customer"], kunnrs: ["0010001003"] },
    { email: "admin@globex.example", roles: ["client_admin"], kunnrs: [] },
  ]);

  console.log(
    [
      "Seeded tenants: acme, globex",
      `All seeded users share the password: ${DEV_PASSWORD}`,
      "Sign in at http://acme.localhost:3000/login as buyer@acme.example",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
