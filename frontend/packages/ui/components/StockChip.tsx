import type { StockAvailability } from "@cc/domain";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

/**
 * Stock chip (docs/05-UI-UX-DESIGN.md §7.2: "In stock n / Low / Out").
 *
 * The chip renders a `StockAvailability` — it never classifies quantities
 * itself. `stockAvailability()` in @cc/domain is the single authority, so
 * the card, the cart warning and the product detail page cannot disagree
 * about what "low" means (CLAUDE.md rule 3).
 */

export interface StockChipProps {
  availability: StockAvailability;
  /** MARD-LABST. Shown alongside the label when known. */
  quantity?: number | null;
  uom?: string;
  /** MARC-WEBAZ — shown for out-of-stock, where the lead time is the answer. */
  leadTimeDays?: number;
  className?: string;
}

const CHIP: Record<StockAvailability, { label: string; className: string }> = {
  in_stock: {
    label: "In stock",
    className: "bg-success-subtle text-success border-success-border",
  },
  low: { label: "Low stock", className: "bg-warning-subtle text-warning border-warning-border" },
  out_of_stock: {
    label: "Out of stock",
    className: "bg-danger-subtle text-danger border-danger-border",
  },
  unknown: {
    label: "Stock unavailable",
    className: "bg-background text-text-dim border-border",
  },
};

export function StockChip({
  availability,
  quantity,
  uom,
  leadTimeDays,
  className,
}: StockChipProps) {
  const chip = CHIP[availability];
  const showQuantity =
    availability !== "unknown" &&
    availability !== "out_of_stock" &&
    quantity !== null &&
    quantity !== undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chip.className,
        className,
      )}
    >
      {chip.label}
      {showQuantity ? (
        <span className="font-mono tabular-nums">
          {quantity}
          {uom ? ` ${uom}` : ""}
        </span>
      ) : null}
      {availability === "out_of_stock" && leadTimeDays ? (
        <span className="font-normal">· {leadTimeDays}d lead</span>
      ) : null}
    </span>
  );
}

/** Stock is a per-customer SAP call loaded lazily per card (docs/05 §7.2). */
export function StockChipSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-5 w-24 rounded-full", className)} />;
}
