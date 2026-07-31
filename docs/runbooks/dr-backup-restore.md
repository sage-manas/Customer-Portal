# DR: backup/restore drill (docs/07 B6)

Not yet run for real — this is the documented plan a first drill should
follow, and the record of what makes this codebase's DR story unusual
enough to need one written down rather than "just restore the database."

## What actually needs to survive a disaster

Read `CLAUDE.md` rule 2 and ADR-016 again before assuming this is a
generic "restore Postgres" drill: most of this portal's data is
**deliberately not stored** — orders, deliveries, invoices, inquiries,
quotations and the credit position are all re-read from SAP on every
request. Postgres holds only what SAP has nowhere to put:

| Data                                                              | Where                                        | Recoverable from a Postgres backup alone?                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenants, users, role assignments                                  | Postgres                                     | Yes                                                                                                                                                                                                                                                                                         |
| Onboarding applications/documents                                 | Postgres + `@cc/adapter-storage`             | Yes, if the storage backend (S3/local disk) is backed up too — the DB row holds only the `storageKey`                                                                                                                                                                                       |
| Cart, order/inquiry drafts                                        | Postgres                                     | Yes (drafts are portal-only; nothing to reconcile against SAP)                                                                                                                                                                                                                              |
| POD confirmations, signed-POD scans                               | Postgres + storage                           | Same as onboarding documents                                                                                                                                                                                                                                                                |
| **Payments**                                                      | Postgres                                     | Yes, and this is the one that matters most — this is the sole record that money was captured before SAP cleared it (ADR-019). **Losing this table between a gateway capture and the SAP posting is losing proof a customer paid.**                                                          |
| Support tickets, comments, attachments                            | Postgres + storage                           | Yes                                                                                                                                                                                                                                                                                         |
| Loyalty tier overrides, credit-limit requests                     | Postgres                                     | Yes                                                                                                                                                                                                                                                                                         |
| Outbox events                                                     | Postgres                                     | Yes, but **anything still `pending`/`failed` at backup time will be relayed again after restore** — every consumer must already be idempotent (ADR-023), so this is expected, not a bug the restore introduces                                                                              |
| Notifications (bell inbox)                                        | Postgres                                     | Yes                                                                                                                                                                                                                                                                                         |
| **Tenant credential vault** (`TenantCredential`, `TenantDataKey`) | Postgres, encrypted under the **master key** | **Only if the master key is also backed up separately.** See the callout below — this is the sharpest risk in the whole drill.                                                                                                                                                              |
| Redis (BullMQ queue state, `@cc/adapter-cache` entries)           | Redis                                        | **No, and it doesn't need to be.** Queue state is transient — a restored outbox `pending` row gets re-relayed regardless of whether BullMQ remembers it existed. Cache entries are fail-open misses on Redis loss (ADR-036); a cold cache after restore is a cost, not a correctness issue. |

## The credential vault is the one genuine landmine

`TenantCredential` rows are AES-256-GCM ciphertext under each tenant's data
key (`TenantDataKey`), which is itself wrapped by the **platform master
key** (`CREDENTIAL_MASTER_KEY` locally, a KMS key in production —
ADR-042). Restoring the Postgres backup restores the ciphertext; it does
**not** restore the master key, because the master key was never in
Postgres to begin with.

**If the master key is lost or not restored alongside the database, every
tenant's stored SAP/GSTN/payment-gateway credentials become permanently
undecryptable — not merely inaccessible, cryptographically unrecoverable.**
The drill must explicitly restore (or confirm KMS access to) the master key
as a separate step, and the runbook for "we restored Postgres but forgot
the master key" is: every tenant re-enters its credentials, there is no
technical recovery.

## Drill steps

1. **Snapshot.** `docker exec <postgres-container> pg_dump -U postgres customerconnect > backup.sql` (or your production equivalent — RDS/Cloud SQL automated snapshots). Separately record/export the master key material (or confirm the KMS key's access policy is itself covered by your KMS provider's own DR story — this codebase's `KmsMasterKeyProvider` is currently a `not_implemented` skeleton per ADR-042, so until it's built, "the master key" means the local `CREDENTIAL_MASTER_KEY` env value, and _that_ is what must be backed up somewhere durable, e.g. a secrets manager, never just the `.env` file on one box).
2. **Simulate loss.** Against a _disposable_ environment only: `docker compose -f docker-compose.dev.yml down -v` (the `-v` drops the named volume — never run this against anything that isn't the drill environment).
3. **Restore.** Bring Postgres back up, `psql -U postgres customerconnect < backup.sql`, restore/confirm the master key is available to the app process, then `pnpm --filter @cc/db db:push` only if the schema itself also needs reconciling (a same-version restore shouldn't need this).
4. **Verify, in this order:**
   - `pnpm --filter @cc/db test:isolation` passes against the restored database (proves tenant scoping structure survived, not just that rows exist).
   - A tenant's stored SAP credential round-trips: `getTenantCredential(tenantId, "sap")` returns the same plaintext it held before the drill — this is the check that actually exercises the master-key risk above, not just "does the table have rows."
   - Every `Payment` row with `state: "captured"` or `"posted"` is present with its `gatewayReference`/`fiDocumentNumber` intact — the one table where a silent restore gap would be a real financial discrepancy, not just a rebuildable cache.
   - Start `packages/workers` and confirm any `pending` outbox rows from before the drill relay successfully (idempotently) rather than erroring.
5. **Record the actual RTO/RPO** the drill measured — time from "simulated loss" to "verification step 4 passes" — and file it as the number this checklist currently has none of. Repeat quarterly, or after any change to the credential-vault or payment schema.

## What this drill deliberately does not cover

Track C's real SAP/GSP integrations are out of scope until they exist — a
DR drill for a real SAP connection's own resilience is a separate exercise
belonging to whoever operates that connectivity (docs/07 Track C, TRD §4.4),
not this portal's own backup/restore story.
