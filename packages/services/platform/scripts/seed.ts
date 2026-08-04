import { db } from "@cc/db";
import type { Role } from "@cc/domain";

import { hashPassword } from "../src/password";

/**
 * Development seed: one operator login per platform role, mirroring
 * `@cc/service-identity/scripts/seed.ts`'s shape (idempotent, refuses a
 * production database).
 *
 * Two rows, not one, for the same reason that seed has two tenants: the
 * difference between `super_admin` and `sap_manager` is only demonstrable
 * when a login exists that *cannot* reach tenant CRUD or billing (doc 09
 * §5). The historical `operator@platform.example` keeps its address so an
 * existing dev database and `apps/ops/.env.example` still work; it is the
 * super admin, which is what a pre-restructure operator already was.
 */

const DEV_PASSWORD = "ops-dev-password";

const DEV_OPERATORS: { email: string; roles: Role[] }[] = [
  { email: "operator@platform.example", roles: ["super_admin"] },
  { email: "sap@platform.example", roles: ["sap_manager"] },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the dev seed against a production environment.");
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const operator of DEV_OPERATORS) {
    await db.operator.upsert({
      where: { email: operator.email },
      update: { passwordHash, roles: operator.roles },
      create: { email: operator.email, passwordHash, roles: operator.roles },
    });
  }

  console.log(
    [
      ...DEV_OPERATORS.map((o) => `Seeded operator ${o.email} (${o.roles.join(",")})`),
      `All seeded operators share the password: ${DEV_PASSWORD}`,
    ].join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
