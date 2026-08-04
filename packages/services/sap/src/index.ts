export { getSapAdapterForTenant, resetSapAdapterForTenant } from "./adapter-resolver";

/**
 * Re-exported so app code can render freshness and translate SAP errors
 * without importing `@cc/adapter-sap` directly — the dependency rule keeps
 * `apps` off the adapters layer (CLAUDE.md rule 1).
 */
export { isSapError, type FreshnessClass, type SapError } from "@cc/adapter-sap";
