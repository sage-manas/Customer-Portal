export { AuthError, isAuthError, type AuthErrorCode } from "./errors";

export { hashPassword, needsRehash, verifyPassword } from "./password";

export {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  issueTokens,
  verifyToken,
  type TokenPair,
  type TokenType,
} from "./jwt";

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

export {
  provisionPortalAccess,
  type ProvisionPortalAccessInput,
  type ProvisionPortalAccessResult,
} from "./provisioning";

export {
  findTenant,
  findTenantByHost,
  findTenantBySlug,
  login,
  setPassword,
  switchAccount,
  type LoginInput,
  type LoginResult,
  type TenantSummary,
} from "./identity-service";
