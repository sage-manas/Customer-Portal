"use client";

import type { InquiryFilter } from "@cc/service-inquiry";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Inquiry filter chips (docs/05 §7.3), the same pattern as the order,
 * delivery and support lists'.
 *
 * URL state, so "what are we still waiting on a price for" survives being
 * forwarded to a colleague.
 */

const CHIPS: ReadonlyArray<{ value: InquiryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Awaiting quotation" },
  { value: "quoted", label: "Quoted" },
];

export function InquiryFilterChips({ active }: { active: InquiryFilter }) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter inquiries" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/inquiries" : `/inquiries?filter=${chip.value}`)
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
