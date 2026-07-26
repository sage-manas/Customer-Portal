import { PrismaClient } from "../generated/client";

import { withTenantScoping } from "./tenant-middleware";

declare global {
  var __ccPrisma: PrismaClient | undefined;
}

function createClient() {
  return new PrismaClient();
}

const basePrisma = globalThis.__ccPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__ccPrisma = basePrisma;

/**
 * The only Prisma client the app should import. All tenant-scoped models
 * are automatically filtered/stamped by tenantId — see tenant-middleware.ts.
 * Callers must wrap requests in `runWithTenant` (tenant-context.ts) first.
 */
export const db = withTenantScoping(basePrisma);

export type Db = typeof db;
