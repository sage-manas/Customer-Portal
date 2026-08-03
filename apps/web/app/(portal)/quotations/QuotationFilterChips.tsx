"use client";

import type { QuotationFilter } from "@cc/service-inquiry";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Quotation filter chips (docs/05 §7.3).
 *
 * Every one of these states except "converted" is derived from the clock at
 * read time rather than stored, so the same quotation legitimately moves
 * between them with nothing having happened to it in SAP.
 */

const CHIPS: ReadonlyArray<{ value: QuotationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Ordered" },
];

export function QuotationFilterChips({ active }: { active: QuotationFilter }) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter quotations" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/quotations" : `/quotations?filter=${chip.value}`)
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-inquiry bg-accent-inquiry/10 text-accent-inquiry"
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
