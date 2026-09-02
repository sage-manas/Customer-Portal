import "dotenv/config";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 moved connection URLs out of `schema.prisma`: the schema now
 * declares only the provider, and the CLI reads the URL from here while the
 * runtime client gets one through a driver adapter (see lib/prisma.ts).
 *
 * `DIRECT_URL` is the unpooled Neon endpoint. Migrations must not run over
 * PgBouncer — it multiplexes transactions across connections, and the schema
 * engine needs a session it keeps.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    // The CLI gets the *unpooled* endpoint: migrations must not run over
    // PgBouncer, which multiplexes transactions across connections while the
    // schema engine needs a session it keeps. Request-time queries use the
    // pooled DATABASE_URL instead, via the adapter in lib/prisma.ts.
    url: env("DIRECT_URL"),
  },
});
