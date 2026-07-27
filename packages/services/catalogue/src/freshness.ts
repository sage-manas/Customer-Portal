import type { FreshnessClass, SapRead } from "@cc/adapter-sap";

/**
 * A composed read is only as fresh as its least-fresh part (ADR-007). Every
 * catalogue read that stitches together material + stock + price goes
 * through here rather than picking one part's freshness and hoping.
 */
export function leastFresh(
  reads: ReadonlyArray<Pick<SapRead<unknown>, "freshness">>,
): FreshnessClass {
  if (reads.some((read) => read.freshness === "stale")) return "stale";
  if (reads.some((read) => read.freshness === "cached")) return "cached";
  return "live";
}

export function earliestSyncedAt(reads: ReadonlyArray<Pick<SapRead<unknown>, "syncedAt">>): string {
  const stamps = reads.map((read) => read.syncedAt).sort();
  return stamps[0] ?? new Date().toISOString();
}
