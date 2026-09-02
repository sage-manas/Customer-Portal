import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPassword } from "../server/auth/password";

/**
 * Development seed.
 *
 * Idempotent and strictly additive: it upserts, never deletes, and it never
 * touches a row it did not create the identity of. The database this points at
 * already holds real tenants and users, so a seed that truncated anything
 * would destroy data the application is the only copy of.
 *
 * It exists to make the six roles signable-in with a known password. That
 * password comes from `SEED_PASSWORD` and has no default: a hardcoded
 * credential in a committed file is one that reaches production eventually.
 *
 *   SEED_PASSWORD='choose-something' npx tsx prisma/seed.ts
 */

const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) {
  console.error(
    "SEED_PASSWORD must be set to at least 12 characters.\n" +
      "  Example: SEED_PASSWORD='local-dev-password' npx tsx prisma/seed.ts",
  );
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

/** Mirrors the six identifiers of the five-tier model (docs/09 §1). */
const TENANT_USERS = [
  {
    email: "buyer@acme-industrial.example",
    roles: ["customer"] as const,
    kunnrs: ["0010001001", "0010001002"],
  },
  { email: "admin@acme-industrial.example", roles: ["client_admin"] as const, kunnrs: [] },
  { email: "ap@acme-industrial.example", roles: ["ap_manager"] as const, kunnrs: [] },
  { email: "ar@acme-industrial.example", roles: ["ar_manager"] as const, kunnrs: [] },
];

const OPERATORS = [
  { email: "ops@customerconnect.example", roles: ["super_admin"] as const },
  { email: "sap@customerconnect.example", roles: ["sap_manager"] as const },
];

async function main() {
  const passwordHash = await hashPassword(password!);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      slug: "acme",
      name: "Acme Industrial",
      sapDriver: "mock",
      gstnDriver: "mock",
      paymentGateway: "mock",
      moduleToggles: {},
    },
  });
  console.log(`tenant  ${tenant.slug} (${tenant.id})`);

  for (const spec of TENANT_USERS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: spec.email } },
      // An existing user keeps their roles and flags; only the dev password is
      // (re)set, which is the one thing this script is for.
      update: { passwordHash },
      create: {
        tenantId: tenant.id,
        email: spec.email,
        roles: [...spec.roles],
        passwordHash,
        isActive: true,
      },
    });

    for (const sapKunnr of spec.kunnrs) {
      await prisma.userAccountLink.upsert({
        where: {
          tenantId_userId_sapKunnr: { tenantId: tenant.id, userId: user.id, sapKunnr },
        },
        update: {},
        create: { tenantId: tenant.id, userId: user.id, sapKunnr },
      });
    }

    console.log(`user    ${spec.email} [${spec.roles.join(", ")}]`);
  }

  for (const spec of OPERATORS) {
    await prisma.operator.upsert({
      where: { email: spec.email },
      update: { passwordHash },
      create: { email: spec.email, roles: [...spec.roles], passwordHash, isActive: true },
    });
    console.log(`op      ${spec.email} [${spec.roles.join(", ")}]`);
  }

  console.log("\nSeed complete. Sign in with SEED_PASSWORD.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
