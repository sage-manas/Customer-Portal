import { Skeleton } from "../primitives/skeleton";

/**
 * Route-level loading fallback.
 *
 * Mirrors the real page's geometry — header block, then rows — so the swap to
 * content does not shift layout. `rows` lets a list route approximate its own
 * table without every route hand-rolling a skeleton.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3.5 shadow-sm">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
