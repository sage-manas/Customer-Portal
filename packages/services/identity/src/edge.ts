/**
 * Edge-safe subset of the identity service.
 *
 * Next.js middleware runs on the edge runtime, where Prisma and Node's
 * `crypto` are unavailable — importing the package root there would pull in
 * `@cc/db` and fail the build. Middleware imports this entry point instead:
 * token verification, tenant resolution from the host, and RBAC checks,
 * all of which are pure or WebCrypto-based.
 *
 * Anything that touches the database (login, switchAccount, setPassword)
 * stays in the package root and runs only in Node route handlers.
 */

export { AuthError, isAuthError, type AuthErrorCode } from "./errors";
export { verifyToken, type TokenType } from "./jwt";
export {
  hostMatchesSession,
  resolveTenantFromHost,
  type HostResolution,
} from "./tenant-resolution";
export {
  requireCustomerAccount,
  requirePermission,
  requireSession,
  resolveActiveKunnr,
} from "./guard";
