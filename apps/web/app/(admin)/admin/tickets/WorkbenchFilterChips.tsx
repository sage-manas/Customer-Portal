"use client";

import type { WorkbenchFilter } from "@cc/service-support";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Workbench filters (docs/05 §8). URL state, so "everything that has
 * breached" is a link an agent can send to their lead.
 *
 * "Breached" reads `slaBreachedAt`, the column the sweep sets — not a
 * recomputed deadline. That is deliberate: the tab shows what the tenant has
 * already been *escalated about*, which is the list a lead is accountable for.
 */

const CHIPS: ReadonlyArray<{ value: WorkbenchFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "Mine" },
  { value: "breached", label: "Breached" },
  { value: "all", label: "All" },
];

export function WorkbenchFilterChips({
  active,
  counts,
}: {
  active: WorkbenchFilter;
  counts: Record<WorkbenchFilter, number>;
}) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter tickets" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(
                chip.value === "open" ? "/admin/tickets" : `/admin/tickets?filter=${chip.value}`,
              )
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-support bg-accent-support/10 text-accent-support"
                : "border-border bg-surface text-text-mid hover:bg-primary-subtle",
              // A breached count above zero is the one number on this row that
              // should catch an eye whether or not the tab is selected.
              chip.value === "breached" && counts.breached > 0 && !selected
                ? "border-danger-border bg-danger-subtle text-danger"
                : null,
            )}
          >
            {chip.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[chip.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
