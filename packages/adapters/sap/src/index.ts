export type {
  FreshnessClass,
  SapAdapter,
  SapConnectionHealth,
  SapDriverName,
  SapRead,
} from "./contract";
export { sapRead } from "./contract";

export {
  SapError,
  isSapError,
  sapNotFound,
  sapNotImplemented,
  sapUnavailable,
  sapValidation,
  type SapErrorKind,
  type SapErrorOptions,
} from "./errors";

export { createSapAdapter, resetSapAdapter, type SapTenantConfig } from "./factory";

export { MockSapAdapter, type MockSapOptions } from "./mock/driver";
export * from "./mock/seed";

export { EccSapAdapter, type EccConnectionConfig } from "./drivers/ecc";
export { S4SapAdapter, type S4ConnectionConfig } from "./drivers/s4";
export { NotImplementedSapAdapter } from "./drivers/not-implemented";
