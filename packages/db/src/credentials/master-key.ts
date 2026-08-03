import { createHash } from "node:crypto";

import { DATA_KEY_LENGTH, openBytes, sealBytes, type SealedBytes } from "./envelope";
import { CredentialVaultError } from "./errors";

/**
 * The outer layer of the envelope (docs/DECISIONS.md ADR-042): wraps and
 * unwraps a tenant's data key. Master-key custody is an external system —
 * an env var locally, a cloud KMS in production — so it gets the same
 * treatment as SAP/GSTN/the payment gateway (CLAUDE.md rule 2): an
 * interface, a driver built first, resolved via a factory. Unlike those,
 * this is a *platform* choice (one provider per process, docs/07 §B1
 * "master key from env locally, KMS in prod"), not a per-tenant one.
 *
 * A real KMS provider (AWS KMS / GCP KMS / Vault transit) would call out
 * per wrap/unwrap rather than ever holding the master key in this
 * process — that shape is preserved here even though only the `env`
 * driver exists today, so swapping drivers later needs no interface
 * change.
 */
export interface MasterKeyProvider {
  readonly driver: "env" | "kms";
  wrapDataKey(dataKey: Buffer): Promise<{ wrapped: SealedBytes; keyVersion: string }>;
  unwrapDataKey(wrapped: SealedBytes, keyVersion: string): Promise<Buffer>;
}

/**
 * Local-dev / self-hosted driver: the master key is a 32-byte value in an
 * env var, base64-encoded. `keyVersion` is derived from the key itself
 * (not a counter) so a row can be told apart from one wrapped under a
 * *different* env value without storing the key material anywhere new —
 * but note this driver keeps no history, so rotating `CREDENTIAL_MASTER_KEY`
 * makes rows wrapped under the old value unreadable; production rotation
 * is a `kms` driver's job, which can keep old key versions active.
 */
export class EnvMasterKeyProvider implements MasterKeyProvider {
  readonly driver = "env" as const;
  private readonly key: Buffer;
  private readonly keyVersion: string;

  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== DATA_KEY_LENGTH) {
      throw new CredentialVaultError(
        `CREDENTIAL_MASTER_KEY must decode to ${DATA_KEY_LENGTH} bytes, got ${key.length}`,
        { kind: "misconfigured" },
      );
    }
    this.key = key;
    this.keyVersion = `env:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  }

  // `async` here isn't idiom for idiom's sake: it's what turns the
  // version-mismatch `throw` below into a rejected promise instead of a
  // synchronous exception, so every caller can uniformly `await` or
  // `.catch()` regardless of which branch runs — including a real `kms`
  // driver's network call, which can only ever reject asynchronously.
  async wrapDataKey(dataKey: Buffer): Promise<{ wrapped: SealedBytes; keyVersion: string }> {
    return { wrapped: sealBytes(this.key, dataKey), keyVersion: this.keyVersion };
  }

  async unwrapDataKey(wrapped: SealedBytes, keyVersion: string): Promise<Buffer> {
    if (keyVersion !== this.keyVersion) {
      throw new CredentialVaultError(
        `Data key was wrapped under master key version ${keyVersion}, but this process holds ${this.keyVersion}`,
        { kind: "misconfigured" },
      );
    }
    return openBytes(this.key, wrapped);
  }
}

/**
 * Production driver placeholder. Follows ADR-006's pattern for the SAP
 * ECC/S4 skeletons: it exists so the factory has a `kms` case to route to,
 * and fails loudly rather than silently falling back to `env`.
 */
export class KmsMasterKeyProvider implements MasterKeyProvider {
  readonly driver = "kms" as const;

  async wrapDataKey(): Promise<{ wrapped: SealedBytes; keyVersion: string }> {
    throw new CredentialVaultError("The kms master-key provider is not implemented yet", {
      kind: "not_implemented",
    });
  }

  async unwrapDataKey(): Promise<Buffer> {
    throw new CredentialVaultError("The kms master-key provider is not implemented yet", {
      kind: "not_implemented",
    });
  }
}

export interface MasterKeyProviderConfig {
  driver: "env" | "kms";
  /** Required for `env`: base64-encoded 32-byte key. */
  envMasterKey?: string;
}

let cached: { key: string; provider: MasterKeyProvider } | undefined;

function build(config: MasterKeyProviderConfig): MasterKeyProvider {
  switch (config.driver) {
    case "env":
      if (!config.envMasterKey) {
        throw new CredentialVaultError(
          "The env master-key provider needs CREDENTIAL_MASTER_KEY set",
          { kind: "misconfigured" },
        );
      }
      return new EnvMasterKeyProvider(config.envMasterKey);
    case "kms":
      return new KmsMasterKeyProvider();
    default: {
      const exhaustive: never = config.driver;
      throw new CredentialVaultError(`Unknown master-key driver: ${String(exhaustive)}`, {
        kind: "misconfigured",
      });
    }
  }
}

/** One provider per process (mirrors `@cc/adapter-cache`'s `createCacheStore`). */
export function createMasterKeyProvider(config: MasterKeyProviderConfig): MasterKeyProvider {
  const key = `${config.driver}::${config.envMasterKey ?? ""}`;
  if (cached?.key === key) return cached.provider;

  const provider = build(config);
  cached = { key, provider };
  return provider;
}

export function resetMasterKeyProvider(): void {
  cached = undefined;
}

/** Reads driver + key straight from env — the shape every resolver uses. */
export function masterKeyProviderFromEnv(): MasterKeyProvider {
  const driver = process.env.CREDENTIAL_MASTER_KEY_PROVIDER === "kms" ? "kms" : "env";
  return createMasterKeyProvider({
    driver,
    envMasterKey: process.env.CREDENTIAL_MASTER_KEY,
  });
}
