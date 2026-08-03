import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { CredentialVaultError } from "./errors";

/**
 * The primitive envelope-encryption operations (docs/DECISIONS.md ADR-042).
 * AES-256-GCM throughout, matching `@cc/service-identity`'s choice of a
 * stdlib primitive over a native addon (docs/02 §8) — no dependency here
 * beyond `node:crypto`.
 *
 * Two layers use the same primitive for different keys: a per-tenant data
 * key encrypts credential JSON, and the master key (`master-key.ts`)
 * encrypts that data key. Neither layer is aware of the other's key.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM's recommended nonce size
export const DATA_KEY_LENGTH = 32; // AES-256

export interface SealedBytes {
  /** Base64. */
  ciphertext: string;
  /** Base64. */
  iv: string;
  /** Base64. */
  authTag: string;
}

/** A fresh random 256-bit data key. Never persisted in plaintext. */
export function generateDataKey(): Buffer {
  return randomBytes(DATA_KEY_LENGTH);
}

/** Encrypts arbitrary bytes under `key` (must be 32 bytes). */
export function sealBytes(key: Buffer, plaintext: Buffer): SealedBytes {
  if (key.length !== DATA_KEY_LENGTH) {
    throw new CredentialVaultError(
      `Envelope key must be ${DATA_KEY_LENGTH} bytes, got ${key.length}`,
      { kind: "misconfigured" },
    );
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypts bytes sealed by `sealBytes`. Throws `CredentialVaultError` (kind
 * `corrupt`) rather than returning garbage when the auth tag doesn't
 * verify — a tampered or wrong-key ciphertext must never decrypt to
 * plausible-looking JSON.
 */
export function openBytes(key: Buffer, sealed: SealedBytes): Buffer {
  if (key.length !== DATA_KEY_LENGTH) {
    throw new CredentialVaultError(
      `Envelope key must be ${DATA_KEY_LENGTH} bytes, got ${key.length}`,
      { kind: "misconfigured" },
    );
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new CredentialVaultError("Envelope ciphertext failed to authenticate", {
      kind: "corrupt",
    });
  }
}

/** Encrypts a JSON-serialisable credential bag under a data key. */
export function sealJson(dataKey: Buffer, value: Record<string, unknown>): SealedBytes {
  return sealBytes(dataKey, Buffer.from(JSON.stringify(value), "utf8"));
}

/** Decrypts and parses a credential bag sealed by `sealJson`. */
export function openJson(dataKey: Buffer, sealed: SealedBytes): Record<string, unknown> {
  const parsed: unknown = JSON.parse(openBytes(dataKey, sealed).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CredentialVaultError("Decrypted credential is not a JSON object", {
      kind: "corrupt",
    });
  }
  return parsed as Record<string, unknown>;
}
