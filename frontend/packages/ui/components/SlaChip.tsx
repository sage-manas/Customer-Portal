import type { SlaView } from "@cc/domain";
import { AlertTriangle, CheckCircle2, Clock, TimerOff } from "lucide-react";

import { cn } from "../lib/cn";
import { relativeTime } from "../lib/relative-time";
import { badgeVariants } from "../primitives/badge";

/**
 * The SLA countdown chip (docs/05-UI-UX-DESIGN.md §7.8: "SLA countdown chip
 * (amber <25% remaining, red breached)").
 *
 * It decides nothing. `slaView` in @cc/domain computes the state from the
 * ticket's `openedAt` and its priority's registered window, so the customer's
 * list, the ticket page and the back-office workbench cannot come to disagree
 * about whether a ticket is late (CLAUDE.md rule 3).
 *
 * Every state carries an icon and a word as well as a colour: an amber chip
 * and a red chip are the same chip to a colour-blind reader, and "late" is not
 * a detail (docs/05 §9).
 */

export interface SlaChipProps {
  sla: SlaView;
  /** Rendered inside a table row: drops the wording down to the time alone. */
  dense?: boolean;
  /** Injectable so stories and tests don't depend on the wall clock. */
  now?: Date;
  className?: string;
}

const PRESENTATION = {
  ok: { Icon: Clock, label: "Due", variant: "neutral" },
  warning: { Icon: AlertTriangle, label: "Due", variant: "warning" },
  breached: { Icon: TimerOff, label: "Overdue", variant: "danger" },
  met: { Icon: CheckCircle2, label: "Met", variant: "success" },
} as const;

export function SlaChip({ sla, dense = false, now, className }: SlaChipProps) {
  const { Icon, label, variant } = PRESENTATION[sla.state];

  // Both branches read from the same deadline. A breached chip says how long
  // ago it was missed rather than a bare "overdue", because the first
  // question an agent asks about a late ticket is *how* late.
  const when = relativeTime(sla.deadline, now);

  return (
    <span
      className={cn(badgeVariants({ variant }), "font-semibold", className)}
      title={`SLA ${sla.state === "met" ? "met" : "due"} ${sla.deadline.toISOString()}`}
    >
      <Icon aria-hidden className="size-3" strokeWidth={2.25} />
      {dense ? null : <span>{label}</span>}
      <span className="tabular-nums">{when}</span>
      <span className="sr-only">
        {sla.state === "breached"
          ? "SLA breached"
          : sla.state === "warning"
            ? "SLA nearly due"
            : sla.state === "met"
              ? "SLA met"
              : "within SLA"}
      </span>
    </span>
  );
}
