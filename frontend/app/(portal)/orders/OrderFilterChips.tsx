"use client";

import type { OrderStatusFilter } from "@cc/service-order";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Status filter chips (docs/05 §7.4: "DataTable with status filter chips
 * mirroring dashboard", §6.3 "filter bar with chips").
 *
 * The chips are URL state, like the catalogue's filters — a filtered order
 * list is something a buyer sends to a colleague ("here are the three we're
 * waiting on"), so it has to survive a copied link.
 *
 * The labels are the customer's vocabulary, not SAP's: "On credit hold", not
 * "CMGST = B" (docs/05 §11).
 */

const CHIPS: ReadonlyArray<{ value: OrderStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "creditHold", label: "On credit hold" },
  { value: "completed", label: "Completed" },
];

export function OrderFilterChips({ active }: { active: OrderStatusFilter }) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter orders by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/orders" : `/orders?filter=${chip.value}`)
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-order bg-accent-order/10 text-accent-order"
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
