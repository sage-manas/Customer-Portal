"use client";

import type { TicketListFilter } from "@cc/service-support";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Ticket filter chips (docs/05 §7.8), the same pattern as the delivery,
 * order and invoice lists'.
 *
 * URL state, so "the queries we still have open" survives being forwarded to
 * a colleague. The counts come from the same query that produced the list, so
 * a tab never claims a number the table then contradicts.
 */

const CHIPS: ReadonlyArray<{ value: TicketListFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export function SupportFilterChips({
  active,
  counts,
}: {
  active: TicketListFilter;
  counts: Record<TicketListFilter, number>;
}) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter tickets by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/support" : `/support?filter=${chip.value}`)
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-support bg-accent-support/10 text-accent-support"
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
