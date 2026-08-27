/**
 * The mock half of `@cc/adapter-sap`, migrated from
 * client/packages/adapters/sap/src.
 *
 * Only `contract.ts`, `errors.ts` and `mock/` came across: those four files
 * depend on nothing but `@cc/domain` (no Prisma, no HTTP, no env), so the
 * seeded SAP landscape they carry is pure frontend data. The real `ecc`/`s4`
 * drivers and the tenant-credential factory stayed behind in /client.
 *
 * TODO(BACKEND):
 * Replace this package with the real `@cc/adapter-sap` (and its tenant
 * credential resolution) once the backend migration lands.
 */

export {
  earliestSyncedAt,
  leastFresh,
  sapRead,
  type FreshnessClass,
  type SapAdapter,
  type SapConnectionHealth,
  type SapRead,
} from "./contract";

export {
  SapError,
  isSapError,
  sapNotFound,
  sapNotImplemented,
  sapUnavailable,
  sapValidation,
  type SapErrorKind,
} from "./errors";

export { MockSapAdapter, type MockSapOptions } from "./mock/driver";
export * from "./mock/seed";
