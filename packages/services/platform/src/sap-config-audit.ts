import { db, runWithTenant } from "@cc/db";
import type { SapDriverKind } from "@cc/domain";
import { isSapConfigAction, type SapConfigAction } from "@cc/domain";

/**
 * The append-only SAP configuration trail (doc 09 §3.3: "config audit
 * trail — who changed what, when").
 *
 * Append-only is a property of the code, not of Postgres: this module
 * exports a writer and a reader and nothing else, and no other module in
 * the repo touches `sapConfigAudit`. That is worth stating plainly rather
 * than implying a database-level guarantee that does not exist — a
 * migration or a psql session can still edit these rows, and pretending
 * otherwise is the kind of claim ADR-024 exists to stop us from making.
 * What the shape *does* guarantee is that no application code path can
 * amend or remove an entry, because none is written.
 *
 * Every call runs inside `runWithTenant`: the model is tenant-scoped
 * (CLAUDE.md rule 4), even though the caller is a cross-tenant console —
 * the console loops over tenants, the same way `getTenantHealth` does,
 * rather than any query running unbound.
 */

export interface SapConfigAuditEntry {
  id: string;
  operatorId: string;
  operatorEmail: string;
  action: SapConfigAction;
  fromDriver: SapDriverKind | null;
  toDriver: SapDriverKind | null;
  /** Connection field *keys* — never values (ADR-053). */
  changedFields: string[];
  result: string | null;
  createdAt: Date;
}

export interface RecordSapConfigAuditInput {
  tenantId: string;
  operatorId: string;
  operatorEmail: string;
  action: SapConfigAction;
  fromDriver?: SapDriverKind | null;
  toDriver?: SapDriverKind | null;
  changedFields?: string[];
  result?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordSapConfigAudit(input: RecordSapConfigAuditInput): Promise<void> {
  await runWithTenant(input.tenantId, () =>
    db.sapConfigAudit.create({
      data: {
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        operatorEmail: input.operatorEmail,
        action: input.action,
        fromDriver: input.fromDriver ?? null,
        toDriver: input.toDriver ?? null,
        changedFields: input.changedFields ?? [],
        result: input.result ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    }),
  );
}

export async function listSapConfigAudit(
  tenantId: string,
  limit = 50,
): Promise<SapConfigAuditEntry[]> {
  const rows = await runWithTenant(tenantId, () =>
    db.sapConfigAudit.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
  );

  return rows.map((row) => ({
    id: row.id,
    operatorId: row.operatorId,
    operatorEmail: row.operatorEmail,
    // The column is a string so the registry in @cc/domain stays the only
    // authority on the action vocabulary (rule 3). A row written before an
    // action was renamed reads back as-is rather than crashing the screen.
    action: isSapConfigAction(row.action) ? row.action : "connection.updated",
    fromDriver: row.fromDriver,
    toDriver: row.toDriver,
    changedFields: row.changedFields,
    result: row.result,
    createdAt: row.createdAt,
  }));
}
