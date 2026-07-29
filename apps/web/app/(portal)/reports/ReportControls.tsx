"use client";

import { REPORT_PERIODS, type ReportPeriodKey } from "@cc/domain";
import { cn } from "@cc/ui";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Period chips + refresh (docs/05 §7.10).
 *
 * URL state, like every other filter in the portal: "our last twelve months"
 * is a link somebody forwards to their finance team, so it has to survive
 * being copied.
 *
 * The refresh button is not decoration. Reports are served from a cache
 * (ADR-036), and the header next to these chips says so with a real "synced"
 * timestamp — so the screen owes the reader a way to ask for a fresh read
 * rather than making them wait out a TTL they cannot see.
 */

const PERIOD_CHIPS: ReadonlyArray<{ value: ReportPeriodKey; label: string }> = REPORT_PERIODS.map(
  (period) => ({ value: period.key, label: period.label }),
);

export function ReportControls({
  active,
  basePath,
}: {
  active: ReportPeriodKey;
  basePath: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Reporting period" className="flex flex-wrap gap-2">
        {PERIOD_CHIPS.map((chip) => {
          const selected = chip.value === active;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                router.push(`${basePath}?period=${chip.value}`);
              }}
              className={cn(
                "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected
                  ? "border-accent-report bg-accent-report/10 text-accent-report"
                  : "border-border bg-surface text-text-mid hover:bg-primary-subtle",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            router.push(`${basePath}?period=${active}&refresh=1`);
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-text-mid transition-colors duration-micro hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
      >
        <RefreshCw aria-hidden className={cn("size-3.5", pending && "animate-spin")} />
        {pending ? "Refreshing…" : "Refresh from SAP"}
      </button>
    </div>
  );
}
