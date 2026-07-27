import type { ObjectStorage, PutObjectInput, StoredObject } from "../contract";
import { StorageError } from "../errors";

/**
 * Object-store driver skeleton (S3/Blob), wired up in Phase 7 with the rest
 * of the production infrastructure. Every method throws `not_implemented`
 * rather than silently degrading to a local directory — a tenant whose
 * documents were supposed to land in an encrypted bucket must not have them
 * written to a container's ephemeral disk instead (ADR-006's reasoning,
 * applied to storage).
 */
export interface S3StorageConfig {
  bucket: string;
  region: string;
  credentialsRef: string;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;

  constructor(private readonly config: S3StorageConfig) {}

  private fail(operation: string): never {
    throw new StorageError(`Document storage is not configured for this tenant yet.`, {
      kind: "not_implemented",
      cause: `s3 driver does not implement ${operation} (bucket ${this.config.bucket})`,
    });
  }

  async put(_input: PutObjectInput): Promise<StoredObject> {
    this.fail("put");
  }

  async get(_key: string): Promise<{ metadata: StoredObject; body: Uint8Array }> {
    this.fail("get");
  }

  async head(_key: string): Promise<StoredObject> {
    this.fail("head");
  }

  async delete(_key: string): Promise<void> {
    this.fail("delete");
  }
}
