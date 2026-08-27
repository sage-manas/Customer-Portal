import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Offset pager for server-rendered lists.
 *
 * Offset, not cursor: the SAP reads behind these screens are `limit`/`offset`
 * against a stable-ordered set, and a customer-facing list needs addressable
 * page numbers more than it needs consistency under concurrent insertion.
 *
 * Emits an href per page rather than an onClick so each page is a real,
 * shareable URL and works before hydration.
 */
export function Pager({
  total,
  pageSize,
  offset,
  hrefFor,
}: {
  total: number;
  pageSize: number;
  offset: number;
  hrefFor: (offset: number) => string;
}) {
  if (total <= pageSize) return null;

  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.ceil(total / pageSize);
  const step =
    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12px] font-medium transition-colors";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-sm"
    >
      <p className="text-[11.5px] tabular-nums text-text-dim">
        {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <a
            href={hrefFor(offset - pageSize)}
            className={cn(step, "text-primary hover:bg-background")}
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            Previous
          </a>
        ) : (
          <span aria-disabled className={cn(step, "text-text-dim opacity-50")}>
            <ChevronLeft aria-hidden className="size-3.5" />
            Previous
          </span>
        )}
        <span className="text-[11.5px] tabular-nums text-text-mid">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <a
            href={hrefFor(offset + pageSize)}
            className={cn(step, "text-primary hover:bg-background")}
          >
            Next
            <ChevronRight aria-hidden className="size-3.5" />
          </a>
        ) : (
          <span aria-disabled className={cn(step, "text-text-dim opacity-50")}>
            Next
            <ChevronRight aria-hidden className="size-3.5" />
          </span>
        )}
      </div>
    </nav>
  );
}
