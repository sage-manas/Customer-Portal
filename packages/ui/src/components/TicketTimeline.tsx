import type { TicketStage } from "@cc/domain";
import { Check, CircleDashed, Dot } from "lucide-react";

import { cn } from "../lib/cn";
import { formatDisplayDate } from "../lib/relative-time";

/**
 * The ticket status timeline (docs/05-UI-UX-DESIGN.md §7.8: "status timeline
 * (Open → In Progress → Resolved → Closed)").
 *
 * Sibling to `DeliveryTracker` and `O2CTimeline`, and deliberately the same
 * shape: `buildTicketTimeline` in @cc/domain decides which stages have been
 * reached, and this renders the answer (CLAUDE.md rule 3).
 *
 * The one thing worth knowing about it: a **reopened** ticket walks back to
 * Open, so later stages show a date but are not "reached". That is not a bug
 * to smooth over — a ticket that was resolved on Tuesday and reopened on
 * Thursday is open, and a timeline that kept Resolved lit would say the
 * opposite of what the customer is looking at.
 */

export interface TicketTimelineProps {
  stages: readonly TicketStage[];
  className?: string;
}

export function TicketTimeline({ stages, className }: TicketTimelineProps) {
  return (
    <ol
      aria-label="Ticket progress"
      className={cn("flex flex-col md:flex-row md:gap-0", "gap-3", className)}
    >
      {stages.map((stage, index) => {
        const Icon = stage.current ? Dot : stage.reached ? Check : CircleDashed;

        return (
          <li
            key={stage.key}
            aria-current={stage.current ? "step" : undefined}
            className="relative flex flex-1 items-center gap-2.5 md:flex-col md:items-stretch md:gap-0"
          >
            {index < stages.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute bg-border",
                  "left-[11px] top-6 h-[calc(100%-0.5rem)] w-px md:left-auto md:top-[11px] md:h-px md:w-full md:translate-x-[calc(50%+12px)]",
                  stage.reached && !stage.current && "bg-accent-support",
                )}
              />
            ) : null}

            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 md:mx-auto",
                stage.current
                  ? "border-accent-support bg-accent-support text-white"
                  : stage.reached
                    ? "border-accent-support bg-accent-support/10 text-accent-support"
                    : "border-border-strong bg-surface text-text-dim",
              )}
            >
              <Icon aria-hidden className="size-3" strokeWidth={2.25} />
            </span>

            <div className="min-w-0 md:mt-2 md:px-1 md:text-center">
              <p
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.5px]",
                  stage.current
                    ? "text-accent-support"
                    : stage.reached
                      ? "text-text-mid"
                      : "text-text-dim",
                )}
              >
                {stage.label}
                {stage.current ? <span className="sr-only"> (current stage)</span> : null}
              </p>
              {/* The date survives a reopen even though the stage does not —
                  it is history, and dropping it would lose when the first
                  attempt at resolving this happened. */}
              {stage.at ? (
                <p className="text-[11px] text-text-dim tabular-nums">
                  {formatDisplayDate(stage.at)}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
