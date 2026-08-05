import { db } from "./client";

/**
 * The one query three services need to ask about a customer account's portal
 * access, kept here rather than in any of them.
 *
 * `login` (identity), the account switcher (identity) and order creation
 * (order) all have to know whether a KUNNR may still act, and a service may
 * not import another service (CLAUDE.md rule 1, ADR-011). The alternatives
 * were three copies of the same `findFirst` — which is how "deactivated"
 * comes to mean three slightly different things — or a fourth service every
 * caller depends on. The query lives in `@cc/db`, which they all already
 * depend on; the *decision* still lives in the domain
 * (`customerAccountBlock`), and the *policy* of what a block prevents stays
 * in each service.
 *
 * Every function here must be called inside `runWithTenant`, like all other
 * access in this package.
 */

/**
 * True when the account may act. An account with **no row** is active:
 * `CustomerAccount` records a decision, and accounts that predate the portal
 * or were created in SAP directly have never had one taken about them.
 * Defaulting the absent row to "blocked" would lock out every customer the
 * portal did not itself register.
 */
export async function isCustomerAccountActive(sapKunnr: string): Promise<boolean> {
  const account = await db.customerAccount.findFirst({
    where: { sapKunnr },
    select: { isActive: true },
  });
  return account?.isActive ?? true;
}

/**
 * Filters a list of KUNNRs down to the ones that may act — the account
 * switcher's list and the login's `availableKunnrs`, in one query rather
 * than one per account.
 */
export async function activeCustomerKunnrs(sapKunnrs: readonly string[]): Promise<string[]> {
  if (sapKunnrs.length === 0) return [];

  const blocked = await db.customerAccount.findMany({
    where: { sapKunnr: { in: [...sapKunnrs] }, isActive: false },
    select: { sapKunnr: true },
  });
  const blockedSet = new Set(blocked.map((account) => account.sapKunnr));

  return sapKunnrs.filter((kunnr) => !blockedSet.has(kunnr));
}
