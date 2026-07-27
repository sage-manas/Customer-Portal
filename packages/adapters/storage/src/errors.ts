export type StorageErrorKind = "not_found" | "rejected" | "unavailable" | "not_implemented";

/**
 * Typed storage errors. `rejected` covers the policy failures the upload
 * component surfaces inline (type not allowed, over the size cap) — those
 * are user errors with user-safe copy, not infrastructure faults.
 */
export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(message: string, options: { kind: StorageErrorKind; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "StorageError";
    this.kind = options.kind;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
