import type { ObjectStorage, StorageDriverName } from "./contract";
import { LocalObjectStorage } from "./drivers/local";
import { MemoryObjectStorage } from "./drivers/memory";
import { S3ObjectStorage, type S3StorageConfig } from "./drivers/s3";
import { StorageError } from "./errors";

/**
 * Storage resolution. Unlike SAP and GSTN this is a *platform* choice, not
 * a per-tenant one — every tenant's objects live in the same store, keyed
 * by tenant — so the cache key is the driver, and tenant isolation is the
 * caller's key prefix plus the DB row that references it.
 */
export interface StorageConfig {
  driver: StorageDriverName;
  /** Required for `local`. */
  root?: string;
  /** Required for `s3`. */
  s3?: S3StorageConfig;
}

let cached: { key: string; storage: ObjectStorage } | undefined;

function build(config: StorageConfig): ObjectStorage {
  switch (config.driver) {
    case "memory":
      return new MemoryObjectStorage();
    case "local":
      if (!config.root) {
        throw new StorageError("The local storage driver needs a root directory.", {
          kind: "not_implemented",
        });
      }
      return new LocalObjectStorage({ root: config.root });
    case "s3":
      if (!config.s3) {
        throw new StorageError("The s3 storage driver needs bucket settings.", {
          kind: "not_implemented",
        });
      }
      return new S3ObjectStorage(config.s3);
    default: {
      const exhaustive: never = config.driver;
      throw new StorageError(`Unknown storage driver: ${String(exhaustive)}`, {
        kind: "not_implemented",
      });
    }
  }
}

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  const key = `${config.driver}::${config.root ?? config.s3?.bucket ?? ""}`;
  if (cached?.key === key) return cached.storage;

  const storage = build(config);
  cached = { key, storage };
  return storage;
}

export function resetObjectStorage(): void {
  cached = undefined;
}
