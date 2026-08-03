import { db } from "@cc/db";

import { hashPassword } from "../src/password";

/**
 * Development seed: one operator login, mirroring
 * `@cc/service-identity/scripts/seed.ts`'s shape (idempotent, refuses a
 * production database). There is exactly one operator role, so there is no
 * per-role fan-out to seed the way the tenant seed has.
 */

const DEV_PASSWORD = "ops-dev-password";
const DEV_EMAIL = "operator@platform.example";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the dev seed against a production environment.");
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  await db.operator.upsert({
    where: { email: DEV_EMAIL },
    update: { passwordHash },
    create: { email: DEV_EMAIL, passwordHash },
  });

  console.log(`Seeded operator ${DEV_EMAIL} / ${DEV_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
