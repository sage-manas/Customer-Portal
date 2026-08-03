export type CredentialVaultErrorKind = "misconfigured" | "not_implemented" | "corrupt";

/**
 * Thrown for programming/configuration errors around the credential vault —
 * a missing master key, an unwrap that doesn't authenticate, a driver that
 * isn't built yet. Never thrown for "no credential stored for this tenant
 * yet", which is a normal `null` return (see vault.ts).
 */
export class CredentialVaultError extends Error {
  readonly kind: CredentialVaultErrorKind;

  constructor(message: string, options: { kind: CredentialVaultErrorKind }) {
    super(message);
    this.name = "CredentialVaultError";
    this.kind = options.kind;
  }
}
