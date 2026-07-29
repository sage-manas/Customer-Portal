"use client";

import type { CreditQueueFilter } from "@cc/service-loyalty";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Credit-desk filter chips, the same pattern as the ticket workbench's.
 *
 * URL state, so a desk user can send "the ones still waiting" to a colleague.
 * The counts come from the same query that produced the list, so a tab never
 * claims a number the list then contradicts.
 */

const CHIPS: ReadonlyArray<{ value: CreditQueueFilter; label: string }> = [
  { value: "pending", label: "Waiting" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
];

export function CreditQueueFilterChips({
  active,
  counts,
}: {
  active: CreditQueueFilter;
  counts: Record<CreditQueueFilter, number>;
}) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter credit requests" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(
                chip.value === "pending" ? "/admin/credit" : `/admin/credit?filter=${chip.value}`,
              )
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-payment bg-accent-payment/10 text-accent-payment"
                : "border-border bg-surface text-text-mid hover:bg-primary-subtle",
            )}
          >
            {chip.label}
            <span className="ml-1.5 tabular-nums text-text-dim">{counts[chip.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
