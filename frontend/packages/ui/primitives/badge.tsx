import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Generic badge primitive. Domain code should use `StatusBadge`
 * (components/StatusBadge.tsx) rather than picking a variant by hand —
 * this primitive exists so StatusBadge (and other chips) have consistent
 * shape/sizing to build on.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium leading-none",
  {
    variants: {
      variant: {
        success: "border-success-border bg-success-subtle text-success",
        warning: "border-warning-border bg-warning-subtle text-warning",
        danger: "border-danger-border bg-danger-subtle text-danger",
        info: "border-info-border bg-info-subtle text-info",
        neutral: "border-border bg-background text-text-mid",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
