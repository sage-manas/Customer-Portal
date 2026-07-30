export { db, type Db } from "./client";
export { runWithTenant, getTenantContext, getTenantId, type TenantContext } from "./tenant-context";
export { withTenantScoping } from "./tenant-middleware";
export { writeOutboxEvent, recordEvent, type OutboxEventInput, type OutboxWriter } from "./outbox";
export {
  getTenantCredential,
  setTenantCredential,
  deleteTenantCredential,
  createMasterKeyProvider,
  resetMasterKeyProvider,
  masterKeyProviderFromEnv,
  EnvMasterKeyProvider,
  KmsMasterKeyProvider,
  CredentialVaultError,
  type MasterKeyProvider,
  type MasterKeyProviderConfig,
  type CredentialVaultErrorKind,
} from "./credentials";
export * from "../generated/client";
