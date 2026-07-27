"use client";

import { Minus, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Quantity stepper with MOQ enforcement (docs/05-UI-UX-DESIGN.md §7.2:
 * "qty stepper + Add to Cart", "MOQ (MVKE-MINBM) enforcement on the
 * stepper").
 *
 * MOQ is enforced here as a courtesy, not as the control: the same rule is
 * applied again in the cart service and a third time by SAP at VA01. A
 * stepper that only *looked* like it enforced it would be a client-side
 * check masquerading as a business rule (docs/05 §4.3).
 */

export interface QtyStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** MVKE-MINBM — also the step, since fractions of a MOQ aren't orderable. */
  minimumOrderQty?: number;
  /** MARA-MEINS, shown as a suffix so the number is never unitless. */
  uom?: string;
  max?: number;
  disabled?: boolean;
  /** Accessible name; required when no visible label sits next to it. */
  label?: string;
  className?: string;
}

export function QtyStepper({
  value,
  onChange,
  minimumOrderQty = 1,
  uom,
  max,
  disabled = false,
  label = "Quantity",
  className,
}: QtyStepperProps) {
  const step = minimumOrderQty > 0 ? minimumOrderQty : 1;
  const [draft, setDraft] = React.useState(String(value));

  React.useEffect(() => setDraft(String(value)), [value]);

  const clamp = (next: number): number => {
    const floored = Math.max(step, next);
    return max !== undefined ? Math.min(floored, max) : floored;
  };

  const commit = (raw: string) => {
    const parsed = Number(raw);
    // An unparseable or below-MOQ entry snaps back rather than silently
    // becoming zero — the customer sees what will actually be ordered.
    onChange(Number.isFinite(parsed) && parsed > 0 ? clamp(parsed) : step);
  };

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-md border border-border bg-surface",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        // Not lowercased: `label` carries the MATNR, and "mat-10001" is a
        // different string from "MAT-10001" to anyone reading it aloud.
        aria-label={`Decrease ${label}`}
        className="px-2 text-text-mid transition-colors duration-micro hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:pointer-events-none"
        disabled={disabled || value <= step}
        onClick={() => onChange(clamp(value - step))}
      >
        <Minus aria-hidden className="size-3.5" />
      </button>

      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
        }}
        className="w-14 border-x border-border bg-transparent px-1 text-center font-mono text-[12.5px] tabular-nums text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      />

      {uom ? (
        <span className="flex items-center px-2 text-[11px] uppercase tracking-wide text-text-dim">
          {uom}
        </span>
      ) : null}

      <button
        type="button"
        aria-label={`Increase ${label}`}
        className="px-2 text-text-mid transition-colors duration-micro hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:pointer-events-none"
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(clamp(value + step))}
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
