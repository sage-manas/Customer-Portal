import type { ObjectStorage, PutObjectInput, StoredObject } from "../contract";
import { StorageError } from "../errors";
import { DEFAULT_UPLOAD_POLICY, assertAllowed, type UploadPolicy } from "../policy";

/**
 * In-process object storage — the mock built first. Bytes live in a Map for
 * the lifetime of the process, which is exactly what tests, Storybook and a
 * single-node dev server need. Nothing above this line knows the difference.
 */
export interface MemoryStorageOptions {
  policy?: Partial<UploadPolicy>;
  now?: () => Date;
}

export class MemoryObjectStorage implements ObjectStorage {
  readonly driver = "memory" as const;

  private readonly objects = new Map<string, { metadata: StoredObject; body: Uint8Array }>();
  private readonly policy: UploadPolicy;
  private readonly now: () => Date;

  constructor(options: MemoryStorageOptions = {}) {
    this.policy = { ...DEFAULT_UPLOAD_POLICY, ...options.policy };
    this.now = options.now ?? (() => new Date());
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertAllowed(input, this.policy);

    const metadata: StoredObject = {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      fileName: input.fileName,
      uploadedAt: this.now().toISOString(),
      // A real driver hands off to a scanner and flips this asynchronously.
      scan: "clean",
    };

    this.objects.set(input.key, { metadata, body: new Uint8Array(input.body) });
    return metadata;
  }

  async get(key: string): Promise<{ metadata: StoredObject; body: Uint8Array }> {
    const object = this.objects.get(key);
    if (!object) throw new StorageError("That file is no longer available.", { kind: "not_found" });
    return { metadata: object.metadata, body: new Uint8Array(object.body) };
  }

  async head(key: string): Promise<StoredObject> {
    return (await this.get(key)).metadata;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
