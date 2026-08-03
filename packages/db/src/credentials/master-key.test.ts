import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { CredentialVaultError } from "./errors";
import {
  createMasterKeyProvider,
  EnvMasterKeyProvider,
  KmsMasterKeyProvider,
  resetMasterKeyProvider,
} from "./master-key";

describe("EnvMasterKeyProvider", () => {
  it("round-trips a wrapped data key", async () => {
    const masterKey = randomBytes(32).toString("base64");
    const provider = new EnvMasterKeyProvider(masterKey);
    const dataKey = randomBytes(32);

    const { wrapped, keyVersion } = await provider.wrapDataKey(dataKey);
    const unwrapped = await provider.unwrapDataKey(wrapped, keyVersion);

    expect(unwrapped.equals(dataKey)).toBe(true);
  });

  it("derives keyVersion from the key material, not a counter", async () => {
    const providerA = new EnvMasterKeyProvider(randomBytes(32).toString("base64"));
    const providerB = new EnvMasterKeyProvider(randomBytes(32).toString("base64"));

    const wrappedA = await providerA.wrapDataKey(randomBytes(32));
    const wrappedB = await providerB.wrapDataKey(randomBytes(32));

    expect(wrappedA.keyVersion).not.toBe(wrappedB.keyVersion);
  });

  it("refuses to unwrap a data key wrapped under a different master key version", async () => {
    const provider = new EnvMasterKeyProvider(randomBytes(32).toString("base64"));
    const { wrapped } = await provider.wrapDataKey(randomBytes(32));

    await expect(provider.unwrapDataKey(wrapped, "env:not-this-ones-version")).rejects.toThrow(
      /master key version/,
    );
  });

  it("rejects a master key that doesn't decode to 32 bytes", () => {
    expect(() => new EnvMasterKeyProvider(Buffer.from("too-short").toString("base64"))).toThrow(
      CredentialVaultError,
    );
  });
});

describe("KmsMasterKeyProvider", () => {
  it("fails loudly rather than silently falling back to env (ADR-006's pattern)", async () => {
    const provider = new KmsMasterKeyProvider();
    await expect(provider.wrapDataKey()).rejects.toMatchObject({ kind: "not_implemented" });
    await expect(provider.unwrapDataKey()).rejects.toMatchObject({ kind: "not_implemented" });
  });
});

describe("createMasterKeyProvider", () => {
  afterEach(() => resetMasterKeyProvider());

  it("caches one provider per process for the same config", () => {
    const config = { driver: "env" as const, envMasterKey: randomBytes(32).toString("base64") };
    expect(createMasterKeyProvider(config)).toBe(createMasterKeyProvider(config));
  });

  it("refuses the env driver with no key configured", () => {
    expect(() => createMasterKeyProvider({ driver: "env" })).toThrow(/needs CREDENTIAL_MASTER_KEY/);
  });

  it("routes to the kms driver", () => {
    expect(createMasterKeyProvider({ driver: "kms" })).toBeInstanceOf(KmsMasterKeyProvider);
  });
});
