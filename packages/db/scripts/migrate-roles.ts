import { LEGACY_ROLES, LEGACY_ROLES_NEEDING_REVIEW, LEGACY_ROLE_MAP, isRole } from "@cc/domain";
import type { LegacyRole, Role } from "@cc/domain";

import { db } from "../src/client";

/**
 * Phase 2 data migration: eight legacy roles → the five-tier model
 * (docs/09-RBAC-RESTRUCTURE-PLAN.md §3.2/§4.2, ADR-049).
 *
 * Three properties, each deliberate:
 *
 * - **The mapping is imported, never restated.** `LEGACY_ROLE_MAP` lives in
 *   `@cc/domain` precisely so this script and any lingering runtime code
 *   give the same answer to "what is a `tenant_sales` now?" (ADR-047). A
 *   copy of the table here is how two answers come to exist.
 * - **It is raw SQL, and that is not a shortcut.** This runs while the
 *   database enum still holds values the *generated Prisma client* no longer
 *   knows — reading `roles` through the typed client would fail to
 *   deserialise them. It is also cross-tenant by nature, so it deliberately
 *   sits outside `runWithTenant`, like the platform-plane tables do; raw
 *   queries carry no `model` and so pass the tenant-scoping extension
 *   untouched (`withTenantScoping`). A one-off backfill over every tenant's
 *   users is the one job that shape is right for.
 * - **Dry-run by default.** It prints the full report and changes nothing
 *   unless `--apply` is passed, because doc 09 §4.2's "listed for manual
 *   review" is only useful if a human can read the list *before* the rows
 *   move.
 *
 * Idempotent: a row with no legacy value is not selected, so re-running
 * after a successful pass reports zero users and exits 0.
 *
 * Ordering (expand-migrate-contract): run this against a database whose
 * `UserRole` enum still has the legacy values, *then* apply the contracted
 * schema (`pnpm --filter @cc/db db:push`). Postgres refuses to drop an enum
 * value still in use, so getting the order wrong fails loudly rather than
 * dropping data.
 *
 *   pnpm --filter @cc/db db:migrate-roles            # report only
 *   pnpm --filter @cc/db db:migrate-roles --apply    # write
 */

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
}

interface Mapping {
  user: UserRow;
  before: string[];
  after: Role[];
  /** Legacy roles this user held that map to strictly more than they had. */
  widened: LegacyRole[];
}

/**
 * The mapped role set for one user.
 *
 * Legacy values are translated, already-current values are kept as they are
 * (a user mid-migration may hold both), and the result is deduplicated —
 * `buyer_admin` + `buyer_user` on one row both become `customer`, and a role
 * list is a set, not a multiset. Anything the registry does not recognise at
 * all is dropped: the fail-closed direction, matching `verifyToken`'s
 * treatment of an unknown role claim.
 */
function mapRoles(roles: string[]): { after: Role[]; widened: LegacyRole[] } {
  const after = new Set<Role>();
  const widened: LegacyRole[] = [];

  for (const role of roles) {
    if (isRole(role)) {
      after.add(role);
      continue;
    }
    const legacy = role as LegacyRole;
    const mapped = LEGACY_ROLE_MAP[legacy];
    if (!mapped) continue;
    after.add(mapped);
    if (LEGACY_ROLES_NEEDING_REVIEW.includes(legacy)) widened.push(legacy);
  }

  return { after: [...after], widened };
}

/**
 * The expand step has two halves and only one of them is the enum.
 *
 * `Operator.roles` is an *additive* column, so it ships with the expanded
 * schema; the enum narrowing is the only thing that must wait for this
 * script. Running against a database that has the legacy enum values but
 * not yet the column is therefore a real, reachable ordering mistake — it
 * was made while rehearsing this migration — and the failure it produces
 * unguarded is a raw Postgres `42703` two hundred lines into the run, after
 * the user backfill has already been applied. Checked up front instead.
 */
async function assertOperatorRolesColumn(): Promise<void> {
  const [{ present }] = await db.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'operators' AND column_name = 'roles'
     ) AS present`,
  );
  if (!present) {
    throw new Error(
      "operators.roles does not exist yet. Apply the schema that adds it " +
        "(with the UserRole enum still expanded) before running this migration — " +
        "see the rollout order in packages/db/README.md.",
    );
  }
}

async function loadLegacyUsers(): Promise<UserRow[]> {
  // `&&` is "arrays overlap": only rows still holding at least one legacy
  // value. `::text[]` on the column so a value the client's enum no longer
  // knows still comes back as a string rather than failing to deserialise.
  return db.$queryRawUnsafe<UserRow[]>(
    `SELECT id, "tenantId", email, roles::text[] AS roles
       FROM users
      WHERE roles::text[] && $1::text[]
      ORDER BY "tenantId", email`,
    [...LEGACY_ROLES],
  );
}

async function applyUser(mapping: Mapping): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE users SET roles = $1::text[]::"UserRole"[] WHERE id = $2`,
    mapping.after,
    mapping.user.id,
  );
}

/**
 * Every operator predates the role column and could already do everything
 * the console offered, which is exactly `platform_operator` — so the map
 * decides this too rather than the string "super_admin" appearing here.
 * Only rows with an empty list are touched, so re-running is a no-op.
 */
async function backfillOperators(apply: boolean): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ id: string; email: string }[]>(
    `SELECT id, email FROM operators WHERE roles = '{}' ORDER BY email`,
  );
  if (apply && rows.length > 0) {
    await db.$executeRawUnsafe(
      `UPDATE operators SET roles = $1::text[]::"UserRole"[] WHERE roles = '{}'`,
      [LEGACY_ROLE_MAP.platform_operator],
    );
  }
  return rows.map((row) => row.email);
}

function report(mappings: Mapping[], operators: string[], apply: boolean): void {
  const verb = apply ? "Migrated" : "Would migrate";
  console.log(`\n=== Role migration report (${apply ? "APPLY" : "DRY RUN"}) ===\n`);

  if (mappings.length === 0) {
    console.log("No users hold a legacy role — nothing to migrate.");
  } else {
    console.log(`${verb} ${mappings.length} user(s):\n`);
    for (const m of mappings) {
      console.log(
        `  ${m.user.email.padEnd(34)} ${m.before.join(",").padEnd(28)} -> ${m.after.join(",")}`,
      );
    }
  }

  console.log(
    `\n${verb} ${operators.length} operator(s) to ` +
      `${LEGACY_ROLE_MAP.platform_operator}${operators.length ? ":" : "."}`,
  );
  for (const email of operators) console.log(`  ${email}`);

  // The part that makes widening acceptable (ADR-047): tenant_sales and
  // tenant_support have no narrower target in the five-tier model, so they
  // land on client_admin and a human is told exactly who, by name.
  const review = mappings.filter((m) => m.widened.length > 0);
  console.log(`\n--- Manual review required: ${review.length} user(s) ---`);
  if (review.length === 0) {
    console.log("None.");
  } else {
    console.log(
      "These held a role with no narrower equivalent and were widened to\n" +
        "client_admin. Re-assign anyone who should hold only ap_manager or\n" +
        "ar_manager:\n",
    );
    for (const m of review) {
      console.log(
        `  ${m.user.email.padEnd(34)} tenant=${m.user.tenantId}  was ${m.widened.join(",")}`,
      );
    }
  }

  if (!apply) console.log("\nDry run — nothing was written. Re-run with --apply.");
  console.log("");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  await assertOperatorRolesColumn();

  const users = await loadLegacyUsers();
  const mappings: Mapping[] = users.map((user) => {
    const { after, widened } = mapRoles(user.roles);
    return { user, before: user.roles, after, widened };
  });

  // A legacy row that maps to nothing would be *silently* stripped of every
  // role by the UPDATE. Refuse rather than write it: a user with no roles is
  // locked out, and a lockout produced by a migration is worse than a
  // migration that stops and says which row it does not understand.
  const unmappable = mappings.filter((m) => m.after.length === 0);
  if (unmappable.length > 0) {
    for (const m of unmappable) {
      console.error(`Cannot map roles for ${m.user.email}: [${m.before.join(", ")}]`);
    }
    throw new Error(`${unmappable.length} user(s) hold roles with no mapping — refusing to write`);
  }

  if (apply) {
    for (const mapping of mappings) await applyUser(mapping);
  }
  const operators = await backfillOperators(apply);

  report(mappings, operators, apply);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
