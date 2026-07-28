"use client";

import type { DeliveryStatusFilter } from "@cc/service-delivery";
import { cn } from "@cc/ui";
import { useRouter } from "next/navigation";

/**
 * Shipment filter chips (docs/05 §7.5), the same pattern as the order and
 * invoice lists'.
 *
 * The chips are URL state: "which deliveries still need signing for" is
 * exactly the link a buyer forwards to their stores team, so it has to
 * survive being copied.
 */

const CHIPS: ReadonlyArray<{ value: DeliveryStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "inTransit", label: "In transit" },
  { value: "awaitingPod", label: "Awaiting receipt" },
  { value: "delivered", label: "Delivered" },
];

export function DeliveryFilterChips({ active }: { active: DeliveryStatusFilter }) {
  const router = useRouter();

  return (
    <div role="group" aria-label="Filter deliveries by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const selected = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              router.push(chip.value === "all" ? "/deliveries" : `/deliveries?filter=${chip.value}`)
            }
            className={cn(
              "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected
                ? "border-accent-delivery bg-accent-delivery/10 text-accent-delivery"
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
