import { CacheError } from "./errors";

/**
 * Cache keys are built here and nowhere else.
 *
 * A cache is a store, and CLAUDE.md rule 4 says tenant isolation in a store
 * is structural rather than conventional: `runWithTenant` makes a Postgres
 * query with no bound tenant throw before it reaches the database, and this
 * is the same guarantee one layer sideways. `cacheKey` cannot produce a key
 * that is not tenant-scoped, because the tenant is a required argument it
 * refuses to accept empty — so the failure mode of a caller who forgets is
 * a throw at the call site, not one customer's aggregate served to another.
 *
 * The KUNNR is a separate, also-required segment for the customer-plane
 * reads, for the reason ADR-032 gives about adapter methods: an entry that
 * could be keyed with the account left off is an entry a back-office read
 * and a customer read could collide on.
 */

export const CACHE_KEY_ROOT = "cc";

const SEPARATOR = ":";

function segment(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CacheError(`A cache key needs a non-empty ${name}.`, { kind: "invalid_key" });
  }
  if (trimmed.includes(SEPARATOR)) {
    // Otherwise "a:b" + "c" and "a" + "b:c" are the same key, and a prefix
    // delete for one tenant could sweep another's rows.
    throw new CacheError(`A cache key ${name} may not contain "${SEPARATOR}": ${trimmed}`, {
      kind: "invalid_key",
    });
  }
  return trimmed;
}

export interface CacheKeyInput {
  tenantId: string;
  /** The report or entity family, e.g. `reports.sales`. */
  namespace: string;
  /** Everything that varies the answer: KUNNR, period, filters. */
  parts?: readonly (string | number)[];
  /**
   * Bump when the *shape* of the cached value changes. Without it, a deploy
   * that adds a field to a report reads yesterday's shape back out of Redis
   * and renders undefined into a KPI tile.
   */
  version: number;
}

export function cacheKey({ tenantId, namespace, parts = [], version }: CacheKeyInput): string {
  return [
    CACHE_KEY_ROOT,
    `v${String(version)}`,
    segment("tenantId", tenantId),
    segment("namespace", namespace),
    ...parts.map((part, index) => segment(`part[${String(index)}]`, String(part))),
  ].join(SEPARATOR);
}

/** Every key belonging to one tenant — what a settings change invalidates. */
export function cacheKeyPrefix(tenantId: string, version: number): string {
  return [CACHE_KEY_ROOT, `v${String(version)}`, segment("tenantId", tenantId)].join(SEPARATOR);
}
