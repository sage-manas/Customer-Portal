import type { AgingSummary } from "@cc/domain";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

import { Money } from "./Money";

/**
 * Aging bar (docs/05-UI-UX-DESIGN.md §3.2: "4-bucket aging bar (0–30 /
 * 31–60 / 61–90 / >90) with amounts, used in AR views").
 *
 * The component renders an `AgingSummary` — it never buckets anything
 * itself. `buildAging()` in @cc/domain is the single authority on which
 * bucket a due date falls in, so the statement, the AR summary and the
 * invoice list cannot disagree (CLAUDE.md rule 3).
 *
 * The bar is proportional to amount, not to bucket count: what matters to a
 * customer is how much of their balance is old, not how many documents are.
 * Severity ramps with age — the >90 bucket is the one someone has to act on.
 */

export interface AmountAgingProps {
  aging: AgingSummary;
  /** Compact form for a dashboard tile: the bar and the total, no table. */
  compact?: boolean;
  /** Called when a bucket is clicked — the AR summary drills into it. */
  onSelectBucket?: (key: AgingSummary["buckets"][number]["key"]) => void;
  className?: string;
}

/**
 * Severity ramps with age. The two warning bands are the same token at
 * different opacity rather than two tokens: the palette (docs/05 §2.1) has
 * one warning colour, and inventing a second would put a colour in the UI
 * that no other component could reuse.
 */
const BUCKET_STYLE: Record<string, { bar: string; text: string; dot: string }> = {
  current: { bar: "bg-success", text: "text-success", dot: "bg-success" },
  d31to60: { bar: "bg-warning/60", text: "text-warning", dot: "bg-warning/60" },
  d61to90: { bar: "bg-warning", text: "text-warning", dot: "bg-warning" },
  over90: { bar: "bg-danger", text: "text-danger", dot: "bg-danger" },
};

const FALLBACK = { bar: "bg-border-strong", text: "text-text-mid", dot: "bg-border-strong" };

export function AmountAging({
  aging,
  compact = false,
  onSelectBucket,
  className,
}: AmountAgingProps) {
  const total = aging.totalOutstanding;
  const hasBalance = total > 0;

  return (
    <section className={cn("space-y-2", className)} aria-label="Outstanding balance by age">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Outstanding
          </p>
          <Money value={total} className="text-[16px] font-bold" />
        </div>
        {aging.totalOverdue > 0 ? (
          <p className="text-[11.5px] font-semibold text-danger">
            <Money value={aging.totalOverdue} className="text-[11.5px] font-semibold text-danger" />{" "}
            overdue
          </p>
        ) : hasBalance ? (
          <p className="text-[11.5px] text-success">Nothing overdue</p>
        ) : null}
      </div>

      {/* The bar itself. Empty state is a flat rail rather than a missing
          element, so the component doesn't change height when a customer
          settles their account. */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-background"
        role="img"
        aria-label={
          hasBalance
            ? aging.buckets
                .filter((bucket) => bucket.amount > 0)
                .map((bucket) => `${bucket.label}: ${bucket.amount.toFixed(2)}`)
                .join(", ")
            : "Nothing outstanding"
        }
      >
        {hasBalance
          ? aging.buckets.map((bucket) =>
              bucket.amount > 0 ? (
                <span
                  key={bucket.key}
                  className={cn("h-full", (BUCKET_STYLE[bucket.key] ?? FALLBACK).bar)}
                  style={{ width: `${(bucket.amount / total) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>

      {compact ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {aging.buckets
            .filter((bucket) => bucket.amount > 0)
            .map((bucket) => (
              <li key={bucket.key} className="flex items-center gap-1.5 text-[11.5px]">
                <span
                  aria-hidden
                  className={cn("size-2 rounded-full", (BUCKET_STYLE[bucket.key] ?? FALLBACK).dot)}
                />
                <span className="text-text-dim">{bucket.label}</span>
                <Money value={bucket.amount} className="text-[11.5px]" showSymbol={false} />
              </li>
            ))}
        </ul>
      ) : (
        <table className="w-full text-[12px]">
          <caption className="sr-only">Outstanding balance by age bucket</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="py-1 font-bold">
                Age
              </th>
              <th scope="col" className="py-1 text-right font-bold">
                Documents
              </th>
              <th scope="col" className="py-1 text-right font-bold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {aging.buckets.map((bucket) => {
              const style = BUCKET_STYLE[bucket.key] ?? FALLBACK;
              const empty = bucket.amount === 0;
              const label = (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-2 rounded-full", style.dot)} />
                  <span className={empty ? "text-text-dim" : style.text}>{bucket.label}</span>
                </span>
              );

              return (
                <tr key={bucket.key} className="border-t border-border">
                  <td className="py-1.5">
                    {onSelectBucket && !empty ? (
                      <button
                        type="button"
                        onClick={() => onSelectBucket(bucket.key)}
                        className="underline-offset-2 hover:underline"
                      >
                        {label}
                      </button>
                    ) : (
                      label
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-text-dim">
                    {bucket.count}
                  </td>
                  <td className="py-1.5 text-right">
                    {empty ? (
                      <span className="text-text-dim">—</span>
                    ) : (
                      <Money value={bucket.amount} className="font-semibold" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** AR reads are per-customer SAP calls, so the bar has a real loading state. */
export function AmountAgingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-2.5 w-full rounded-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
