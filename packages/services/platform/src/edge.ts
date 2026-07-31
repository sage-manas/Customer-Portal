/**
 * Edge-safe subset of `@cc/service-platform`, mirroring
 * `@cc/service-identity/edge`'s reasoning exactly: `apps/ops/middleware.ts`
 * runs on the edge runtime, where Prisma is unavailable, so it must not
 * import the package root (which pulls in `@cc/db` via `operator-service.ts`
 * and `tenant-provisioning.ts`). Only pure, `jose`-based token verification
 * is edge-safe.
 */

export { PlatformError, isPlatformError, type PlatformErrorCode } from "./errors";
export { verifyOperatorToken, type OperatorClaims, type OperatorTokenType } from "./jwt";
