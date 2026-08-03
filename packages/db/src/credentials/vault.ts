import type { CredentialSystem } from "../../generated/client";
import { db } from "../client";

import { generateDataKey, openJson, sealJson, type SealedBytes } from "./envelope";
import { CredentialVaultError } from "./errors";
import { masterKeyProviderFromEnv, type MasterKeyProvider } from "./master-key";

/**
 * The per-tenant credential vault (docs/DECISIONS.md ADR-042): the only
 * place that reads or writes `TenantCredential`/`TenantDataKey` rows.
 *
 * Both models are tenant-scoped (`tenant-middleware.ts`), so every call
 * here must run inside `runWithTenant(tenantId, ...)` — exactly like every
 * other tenant-owned table (CLAUDE.md rule 4). The resolvers this is built
 * for (`getSapAdapterForTenant` and siblings) already run there, since
 * they're invoked from request-scoped route handlers.
 *
 * A missing credential is not an error: `getTenantCredential` returns
 * `null` for "nothing stored yet", which every caller here treats as
 * "fall back to whatever the driver does without one" — the vault does not
 * decide whether a system requires a credential, the adapter factory does
 * (ADR-006's "fail loudly" belongs there, not here).
 */

async function getOrCreateTenantDataKey(
  tenantId: string,
  provider: MasterKeyProvider,
): Promise<Buffer> {
  const existing = await db.tenantDataKey.findUnique({ where: { tenantId } });
  if (existing) {
    if (existing.provider !== provider.driver) {
      throw new CredentialVaultError(
        `Tenant ${tenantId}'s data key is wrapped by the '${existing.provider}' master-key provider, but this process is configured for '${provider.driver}'. Re-wrap it under the new provider before switching.`,
        { kind: "misconfigured" },
      );
    }
    return provider.unwrapDataKey(
      { ciphertext: existing.wrappedKey, iv: existing.wrapIv, authTag: existing.wrapAuthTag },
      existing.keyVersion,
    );
  }

  const dataKey = generateDataKey();
  const { wrapped, keyVersion } = await provider.wrapDataKey(dataKey);
  // Upsert rather than create: two concurrent first-writers for the same
  // tenant race here, and the loser's wrap should be discarded rather than
  // conflict — `update: {}` keeps whichever row Postgres committed first.
  await db.tenantDataKey.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      wrappedKey: wrapped.ciphertext,
      wrapIv: wrapped.iv,
      wrapAuthTag: wrapped.authTag,
      keyVersion,
      provider: provider.driver,
    },
  });

  // Re-read rather than trust the in-hand `dataKey`: if we lost the race,
  // the row that actually landed was wrapped (and must be unwrapped) with
  // a different data key than the one generated in this call.
  const row = await db.tenantDataKey.findUniqueOrThrow({ where: { tenantId } });
  if (row.keyVersion === keyVersion && row.wrappedKey === wrapped.ciphertext) {
    return dataKey;
  }
  return provider.unwrapDataKey(
    { ciphertext: row.wrappedKey, iv: row.wrapIv, authTag: row.wrapAuthTag },
    row.keyVersion,
  );
}

/** Returns the decrypted credential bag, or `null` if none is stored. */
export async function getTenantCredential(
  tenantId: string,
  system: CredentialSystem,
  provider: MasterKeyProvider = masterKeyProviderFromEnv(),
): Promise<Record<string, unknown> | null> {
  const row = await db.tenantCredential.findUnique({
    where: { tenantId_system: { tenantId, system } },
  });
  if (!row) return null;

  const dataKey = await getOrCreateTenantDataKey(tenantId, provider);
  const sealed: SealedBytes = { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag };
  return openJson(dataKey, sealed);
}

/** Encrypts and stores (or replaces) a tenant's credential for `system`. */
export async function setTenantCredential(
  tenantId: string,
  system: CredentialSystem,
  credential: Record<string, unknown>,
  provider: MasterKeyProvider = masterKeyProviderFromEnv(),
): Promise<void> {
  const dataKey = await getOrCreateTenantDataKey(tenantId, provider);
  const sealed = sealJson(dataKey, credential);

  await db.tenantCredential.upsert({
    where: { tenantId_system: { tenantId, system } },
    update: { ciphertext: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag },
    create: {
      tenantId,
      system,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
    },
  });
}

/** Deletes a tenant's stored credential for `system`, if any. */
export async function deleteTenantCredential(
  tenantId: string,
  system: CredentialSystem,
): Promise<void> {
  await db.tenantCredential.deleteMany({ where: { tenantId, system } });
}
