export {
  generateDataKey,
  sealBytes,
  openBytes,
  sealJson,
  openJson,
  type SealedBytes,
} from "./envelope";
export {
  createMasterKeyProvider,
  resetMasterKeyProvider,
  masterKeyProviderFromEnv,
  EnvMasterKeyProvider,
  KmsMasterKeyProvider,
  type MasterKeyProvider,
  type MasterKeyProviderConfig,
} from "./master-key";
export { getTenantCredential, setTenantCredential, deleteTenantCredential } from "./vault";
export { CredentialVaultError, type CredentialVaultErrorKind } from "./errors";
