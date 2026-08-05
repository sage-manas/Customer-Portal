import {
  db,
  deleteTenantCredential,
  getTenantCredential,
  runWithTenant,
  setTenantCredential,
} from "@cc/db";
import type { SapDriverKind } from "@cc/domain";
import {
  missingSapConnectionFields,
  sapConnectionDiff,
  sapConnectionFields,
  sapConnectionSchema,
} from "@cc/domain";

import { PlatformError } from "./errors";
import { recordSapConfigAudit } from "./sap-config-audit";

/**
 * Per-tenant SAP connection configuration (doc 09 §3.3, doc 10 Phase 4) —
 * the screen both platform roles share, and the only write path in the
 * console that `sap_manager` holds.
 *
 * Three things are load-bearing here.
 *
 * **The fields come from the registry, not from this file.** Which
 * parameters an ECC connection needs is `SAP_CONNECTION_FIELDS` in
 * @cc/domain; the form renders from it, this module validates and diffs
 * against it, and `@cc/service-sap`'s resolver reads the same keys back
 * out. A driver's connection shape is declared once (CLAUDE.md rule 3).
 *
 * **Secrets go out one way.** `getTenantSapConfig` returns non-secret
 * values so an operator can see what a tenant points at, and returns only
 * *whether* each secret is set. A save that omits a secret leaves the
 * stored one alone, which is what lets an endpoint be corrected without
 * anyone retyping a password — and means no code path ever renders a
 * credential into a page.
 *
 * **Nothing here builds a SapAdapter.** Testing a connection needs one, and
 * `@cc/service-sap` owns adapter resolution; a service may not import
 * another service (rule 1, ADR-011), so `testSapConnection` takes the
 * adapter as an argument and the ops route handler is what sequences the
 * two. That is not a workaround for the rule — it is the reason the rule
 * reads well here: this module knows what a *configuration* is, and the SAP
 * service knows what an *adapter* is, and neither has to learn the other.
 */

export interface SapConnectionFieldState {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Non-secret current value; always null for a secret field. */
  value: string | null;
  /** Whether a value is stored — the only thing a secret discloses. */
  isSet: boolean;
}

export interface TenantSapConfig {
  tenantId: string;
  tenantName: string;
  driver: SapDriverKind;
  fields: SapConnectionFieldState[];
  /** Required fields with nothing stored — the configuration is incomplete. */
  missing: string[];
}

/** The stored bag, decrypted. Tenant-scoped, hence `runWithTenant`. */
async function readParams(tenantId: string): Promise<Record<string, string>> {
  const stored = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
  if (!stored) return {};

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

async function loadTenant(tenantId: string) {
  // `tenants` is platform-plane, like every other read of it in this
  // package — not tenant-scoped, so deliberately outside runWithTenant.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new PlatformError("not_found");
  return tenant;
}

export async function getTenantSapConfig(tenantId: string): Promise<TenantSapConfig> {
  const tenant = await loadTenant(tenantId);
  const params = await readParams(tenantId);

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    driver: tenant.sapDriver,
    fields: sapConnectionFields(tenant.sapDriver).map((field) => ({
      key: field.key,
      label: field.label,
      secret: field.secret,
      required: field.required,
      placeholder: field.placeholder,
      help: field.help,
      value: field.secret ? null : (params[field.key] ?? null),
      isSet: typeof params[field.key] === "string" && params[field.key] !== "",
    })),
    missing: missingSapConnectionFields(tenant.sapDriver, params).map((field) => field.key),
  };
}

export interface UpdateSapConfigInput {
  tenantId: string;
  driver: SapDriverKind;
  /** Submitted connection parameters, keyed as the registry declares. */
  params: Record<string, string>;
  /** Secret fields to blank out — omission means "leave the stored one". */
  clearSecrets?: string[];
  operatorId: string;
  operatorEmail: string;
}

export interface UpdateSapConfigResult {
  driverChanged: boolean;
  changedFields: string[];
  missing: string[];
}

/**
 * Writes the tenant's driver and connection parameters, then appends to the
 * trail. Not one transaction with the vault write, deliberately: the
 * `Tenant` row and the credential live in the same database but the trail's
 * job is to record that somebody *tried*, and a failed write that left no
 * trace is the entry an investigation most wants. The order is
 * config-then-trail so a trail entry always describes a change that landed.
 */
export async function updateTenantSapConfig(
  input: UpdateSapConfigInput,
): Promise<UpdateSapConfigResult> {
  const tenant = await loadTenant(input.tenantId);
  const previousDriver = tenant.sapDriver;
  const driverChanged = previousDriver !== input.driver;

  const parsed = sapConnectionSchema(input.driver).safeParse(input.params);
  if (!parsed.success) {
    throw new PlatformError("invalid_sap_config", {
      detail: parsed.error.issues[0]?.message ?? "Invalid connection parameters",
    });
  }

  const before = await readParams(input.tenantId);
  const allowed = new Set(sapConnectionFields(input.driver).map((field) => field.key));

  // Start from the stored bag, dropping keys the *new* driver has no use
  // for: leaving an ECC `systemNumber` behind after a switch to S/4 would
  // make the trail's diffs meaningless and the vault a museum.
  const after: Record<string, string> = {};
  for (const [key, value] of Object.entries(before)) {
    if (allowed.has(key)) after[key] = value;
  }

  for (const field of sapConnectionFields(input.driver)) {
    const submitted = parsed.data[field.key];
    if (submitted === undefined) continue;

    const value = submitted.trim();
    if (field.secret && value === "") continue; // omitted, not cleared
    if (value === "") delete after[field.key];
    else after[field.key] = value;
  }

  for (const key of input.clearSecrets ?? []) {
    if (allowed.has(key)) delete after[key];
  }

  const changedFields = sapConnectionDiff(input.driver, before, after);

  if (driverChanged) {
    await db.tenant.update({
      where: { id: input.tenantId },
      data: { sapDriver: input.driver },
    });
  }

  if (Object.keys(after).length === 0) {
    // The mock driver's normal state, and the honest representation of a
    // cleared connection: no row rather than an encrypted empty object.
    await runWithTenant(input.tenantId, () => deleteTenantCredential(input.tenantId, "sap"));
  } else if (changedFields.length > 0 || driverChanged) {
    await runWithTenant(input.tenantId, () => setTenantCredential(input.tenantId, "sap", after));
  }

  if (driverChanged) {
    await recordSapConfigAudit({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      operatorEmail: input.operatorEmail,
      action: "driver.changed",
      fromDriver: previousDriver,
      toDriver: input.driver,
    });
  }

  if (changedFields.length > 0) {
    await recordSapConfigAudit({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      operatorEmail: input.operatorEmail,
      action: Object.keys(after).length === 0 ? "connection.cleared" : "connection.updated",
      toDriver: input.driver,
      changedFields,
    });
  }

  return {
    driverChanged,
    changedFields,
    missing: missingSapConnectionFields(input.driver, after).map((field) => field.key),
  };
}

export interface SapConnectionTestResult {
  reachable: boolean;
  driver: string;
  circuit: "closed" | "open" | "half-open" | "unknown";
  checkedAt: string;
  /** Present when the probe threw — the message, never a stack or a secret. */
  error?: string;
}

/** The narrow slice of `SapAdapter` a connection test needs. `@cc/service-platform`
 * does not depend on `@cc/adapter-sap`, so the shape is structural: the caller
 * hands in whatever `getSapAdapterForTenant` returned. */
export interface SapHealthProbe {
  health(): Promise<{
    reachable: boolean;
    driver: string;
    circuit: "closed" | "open" | "half-open";
    checkedAt: string;
  }>;
}

/**
 * Runs the adapter's own health probe and records the attempt.
 *
 * It never throws: a connection test that 500s tells the operator only that
 * something is wrong somewhere, which is the one thing they already knew.
 * A driver that is not certified yet (ecc/s4 throw `not_implemented`,
 * ADR-006) is a legitimate, informative answer here — "configured, not
 * reachable" — rather than an error the console has to translate.
 */
export async function testSapConnection(
  tenantId: string,
  adapter: SapHealthProbe,
  operator: { operatorId: string; email: string },
): Promise<SapConnectionTestResult> {
  let result: SapConnectionTestResult;

  try {
    const health = await adapter.health();
    result = {
      reachable: health.reachable,
      driver: health.driver,
      circuit: health.circuit,
      checkedAt: health.checkedAt,
    };
  } catch (error) {
    result = {
      reachable: false,
      driver: "unknown",
      circuit: "unknown",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Connection test failed",
    };
  }

  await recordSapConfigAudit({
    tenantId,
    operatorId: operator.operatorId,
    operatorEmail: operator.email,
    action: "connection.tested",
    result: result.reachable ? "reachable" : (result.error ?? "unreachable"),
  });

  return result;
}
