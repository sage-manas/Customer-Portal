"use client";

import type { InvoiceStatusFilter } from "@cc/service-invoice";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Status filter chips (docs/05 §7.6: "filters (date FY-aware, status
 * Open/Overdue/Paid), aging chip per row"), the same pattern as the order
 * list's.
 *
 * The chips are URL state: "our overdue invoices" is exactly the link a
 * buyer forwards to their accounts team, so it has to survive being copied.
 */

const CHIPS: ReadonlyArray<{ value: InvoiceStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

export function InvoiceFilterChips({ active }: { active: InvoiceStatusFilter }) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter invoices by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/invoices" : `/invoices?filter=${chip.value}`)
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-invoice bg-accent-invoice/10 text-accent-invoice"
                : "border-border bg-surface text-text-mid hover:bg-primary-subtle",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
