import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ObjectStorage, PutObjectInput, StoredObject } from "../contract";
import { StorageError } from "../errors";
import { DEFAULT_UPLOAD_POLICY, assertAllowed, type UploadPolicy } from "../policy";

/**
 * Filesystem-backed development driver — the same mock, but the bytes
 * survive a dev-server restart, so a half-finished application still has
 * its uploads after a hot reload. Metadata rides alongside each object as a
 * `.json` sidecar rather than in the DB: the DB row is the *reference*, and
 * a driver that needed the DB to describe its own objects would leak that
 * coupling into the real S3 driver later.
 */
export interface LocalStorageOptions {
  /** Root directory; created on first write. */
  root: string;
  policy?: Partial<UploadPolicy>;
  now?: () => Date;
}

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;

  private readonly policy: UploadPolicy;
  private readonly now: () => Date;

  constructor(private readonly options: LocalStorageOptions) {
    this.policy = { ...DEFAULT_UPLOAD_POLICY, ...options.policy };
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Resolves a key under the root and refuses anything that escapes it — a
   * key is caller-supplied, and `../` in one would otherwise be an
   * arbitrary-file read.
   */
  private resolve(key: string): string {
    const root = path.resolve(this.options.root);
    const target = path.resolve(root, key);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new StorageError("Invalid storage key.", { kind: "rejected" });
    }
    return target;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertAllowed(input, this.policy);

    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });

    const metadata: StoredObject = {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      fileName: input.fileName,
      uploadedAt: this.now().toISOString(),
      scan: "clean",
    };

    await writeFile(target, input.body);
    await writeFile(`${target}.json`, JSON.stringify(metadata), "utf8");
    return metadata;
  }

  async get(key: string): Promise<{ metadata: StoredObject; body: Uint8Array }> {
    const target = this.resolve(key);
    try {
      const [body, metadata] = await Promise.all([
        readFile(target),
        readFile(`${target}.json`, "utf8"),
      ]);
      return { metadata: JSON.parse(metadata) as StoredObject, body: new Uint8Array(body) };
    } catch (cause) {
      throw new StorageError("That file is no longer available.", { kind: "not_found", cause });
    }
  }

  async head(key: string): Promise<StoredObject> {
    return (await this.get(key)).metadata;
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await rm(target, { force: true });
    await rm(`${target}.json`, { force: true });
  }
}
