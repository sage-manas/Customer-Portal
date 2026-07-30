import { describe, expect, it } from "vitest";

import { generateDataKey, openBytes, openJson, sealBytes, sealJson } from "./envelope";
import { CredentialVaultError } from "./errors";

describe("envelope encryption", () => {
  it("round-trips bytes under a generated data key", () => {
    const key = generateDataKey();
    const sealed = sealBytes(key, Buffer.from("hello vault", "utf8"));

    expect(openBytes(key, sealed).toString("utf8")).toBe("hello vault");
  });

  it("round-trips a credential JSON bag", () => {
    const key = generateDataKey();
    const credential = { username: "svc_account", password: "s3cr3t!" };
    const sealed = sealJson(key, credential);

    expect(openJson(key, sealed)).toEqual(credential);
  });

  it("produces a different ciphertext (and iv) each time — never a reused nonce", () => {
    const key = generateDataKey();
    const a = sealBytes(key, Buffer.from("same plaintext"));
    const b = sealBytes(key, Buffer.from("same plaintext"));

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses to decrypt under the wrong key", () => {
    const sealed = sealBytes(generateDataKey(), Buffer.from("secret"));

    expect(() => openBytes(generateDataKey(), sealed)).toThrow(CredentialVaultError);
  });

  it("refuses to decrypt tampered ciphertext", () => {
    const key = generateDataKey();
    const sealed = sealBytes(key, Buffer.from("secret"));
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from("not the real bytes").toString("base64"),
    };

    expect(() => openBytes(key, tampered)).toThrow(/failed to authenticate/);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => sealBytes(Buffer.alloc(16), Buffer.from("x"))).toThrow(/32 bytes/);
  });
});
