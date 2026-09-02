import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";
import { serverEnv } from "@/server/env";

/**
 * The one Prisma client for the process.
 *
 * Cached on `globalThis` because Next's dev server re-evaluates modules on
 * every hot reload; without it each edit opens another pool against Neon and
 * the connection limit is reached in a few minutes.
 *
 * Prisma 7 no longer reads `url` from the schema — the connection is supplied
 * here through a driver adapter, which is also what keeps `DATABASE_URL` on
 * the server: this module is `server-only`, so importing it from a client
 * component is a build error rather than a leaked credential.
 *
 * `DATABASE_URL` is Neon's pooled (PgBouncer) endpoint and is the right one
 * for request-time queries. Migrations use `DIRECT_URL` instead, via
 * prisma.config.ts.
 */

const adapter = new PrismaPg({ connectionString: serverEnv.DATABASE_URL });

const globalForPrisma = globalThis as typeof globalThis & {
  __ccPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__ccPrisma ??
  new PrismaClient({
    adapter,
    log: serverEnv.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (serverEnv.NODE_ENV !== "production") {
  globalForPrisma.__ccPrisma = prisma;
}

export type { PrismaClient };
export * from "./generated/prisma/enums";
