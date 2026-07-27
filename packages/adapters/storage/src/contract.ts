/**
 * Portal object storage — where uploaded documents live before they are
 * attached to the SAP object via GOS (docs/03 Screen 1.4).
 *
 * Same mock-first pattern as SAP and GSTN: an interface, a mock built
 * first, real drivers behind a factory. Service code holds a `storageKey`
 * and this contract; it never knows whether the bytes are in memory, on
 * disk, or in a bucket.
 */

export type StorageDriverName = "memory" | "local" | "s3";

export interface StoredObject {
  /** Opaque key the caller persists; the only handle to the bytes. */
  key: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  uploadedAt: string;
  /**
   * Virus-scan state. `FileUpload` renders a "scanning" state for it
   * (docs/05 §3.2); the mock marks uploads clean immediately, a real driver
   * flips it asynchronously.
   */
  scan: "clean" | "pending" | "infected";
}

export interface PutObjectInput {
  /**
   * Key prefix, always tenant-scoped by the caller
   * (`<tenantId>/onboarding/<applicationId>/...`) so one tenant's objects
   * can never collide with — or be guessed from — another's.
   */
  key: string;
  body: Uint8Array;
  contentType: string;
  fileName: string;
}

export interface ObjectStorage {
  readonly driver: StorageDriverName;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<{ metadata: StoredObject; body: Uint8Array }>;
  head(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}
