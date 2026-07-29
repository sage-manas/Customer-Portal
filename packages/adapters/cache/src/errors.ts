export type CacheErrorKind = "misconfigured" | "invalid_key";

/**
 * The only two things this adapter throws for, and neither is a backend
 * fault — those are fail-open by contract (see contract.ts). A cache key
 * built without a tenant, or a driver configured without the settings it
 * needs, are programming errors that must surface loudly rather than
 * degrade into a quiet miss that leaks one tenant's aggregate to another.
 */
export class CacheError extends Error {
  readonly kind: CacheErrorKind;

  constructor(message: string, options: { kind: CacheErrorKind; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "CacheError";
    this.kind = options.kind;
  }
}

export function isCacheError(error: unknown): error is CacheError {
  return error instanceof CacheError;
}
