import type { QuotationValidity } from "@cc/domain";
import { CalendarCheck, CalendarClock, CalendarX } from "lucide-react";

import { cn } from "../lib/cn";
import { relativeTime } from "../lib/relative-time";
import { badgeVariants } from "../primitives/badge";

/**
 * The quotation countdown chip (docs/05-UI-UX-DESIGN.md §7.3: "**Valid Until**
 * with countdown chip amber <72h").
 *
 * The sibling of `SlaChip`, and it decides just as little: `quotationValidity`
 * in @cc/domain reads VBAK-BNDDT against the clock and returns the state, so
 * the list, the quotation page and the service's own acceptance check cannot
 * disagree about whether an offer still stands (CLAUDE.md rule 3).
 *
 * Every state carries an icon and a word as well as a colour — an amber chip
 * and a red chip are the same chip to a colour-blind reader, and "you can no
 * longer accept this price" is not a detail (docs/05 §9).
 */

export interface ValidityChipProps {
  validity: QuotationValidity;
  /** Rendered inside a table row: drops the wording down to the time alone. */
  dense?: boolean;
  /** Injectable so stories and tests don't depend on the wall clock. */
  now?: Date;
  className?: string;
}

const PRESENTATION = {
  valid: { Icon: CalendarCheck, label: "Valid", variant: "neutral" },
  expiring: { Icon: CalendarClock, label: "Expires", variant: "warning" },
  expired: { Icon: CalendarX, label: "Expired", variant: "danger" },
} as const;

export function ValidityChip({ validity, dense = false, now, className }: ValidityChipProps) {
  const { Icon, label, variant } = PRESENTATION[validity.state];

  return (
    <span
      className={cn(badgeVariants({ variant }), "font-semibold", className)}
      title={`Quotation valid until ${validity.expiresAt.toISOString().slice(0, 10)}`}
    >
      <Icon aria-hidden className="size-3" strokeWidth={2.25} />
      {dense ? null : <span>{label}</span>}
      <span className="tabular-nums">{relativeTime(validity.expiresAt, now)}</span>
      <span className="sr-only">
        {validity.state === "expired"
          ? "this quotation has expired"
          : validity.state === "expiring"
            ? "this quotation expires soon"
            : "this quotation is still valid"}
      </span>
    </span>
  );
}
