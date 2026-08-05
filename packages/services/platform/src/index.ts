export { PlatformError, isPlatformError, type PlatformErrorCode } from "./errors";

export { hashPassword, verifyPassword } from "./password";

export {
  OPERATOR_ACCESS_TOKEN_TTL_SECONDS,
  OPERATOR_CLAIM_VERSION,
  OPERATOR_REFRESH_TOKEN_TTL_SECONDS,
  issueOperatorTokens,
  verifyOperatorToken,
  type OperatorClaims,
  type OperatorTokenPair,
  type OperatorTokenType,
} from "./jwt";

export { requireOperatorPermission, requireOperatorSession } from "./guard";

export { operatorLogin, setOperatorPassword, type OperatorLoginResult } from "./operator-service";

export {
  createTenant,
  getTenant,
  listTenants,
  type CreateTenantInput,
  type CreateTenantResult,
  type TenantListItem,
} from "./tenant-provisioning";

export {
  setTenantActive,
  updateTenant,
  type SetTenantActiveResult,
  type UpdateTenantInput,
} from "./tenant-admin";

export {
  createOperator,
  listOperators,
  setOperatorActive,
  type CreateOperatorInput,
  type CreateOperatorResult,
  type OperatorListItem,
} from "./operator-admin";

export {
  getTenantSapConfig,
  testSapConnection,
  updateTenantSapConfig,
  type SapConnectionFieldState,
  type SapConnectionTestResult,
  type SapHealthProbe,
  type TenantSapConfig,
  type UpdateSapConfigInput,
  type UpdateSapConfigResult,
} from "./tenant-sap-config";

export {
  listSapConfigAudit,
  recordSapConfigAudit,
  type RecordSapConfigAuditInput,
  type SapConfigAuditEntry,
} from "./sap-config-audit";

export { getTenantHealth, type SapConnectivityStatus, type TenantHealth } from "./tenant-health";

export { getTenantUsage, type TenantUsage } from "./tenant-usage";

export { getTenantBilling } from "./tenant-billing";
