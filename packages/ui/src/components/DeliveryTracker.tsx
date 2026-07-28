import type { DeliveryStage } from "@cc/domain";
import { Check, CircleDashed, Truck } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * The shipment stepper (docs/05-UI-UX-DESIGN.md §7.5): "status stepper Not
 * Started → Picked → Packed → Shipped → Delivered (WBSTK + PGI events)".
 *
 * Like `O2CTimeline`, it decides nothing: the stages and which of them have
 * been reached are computed by `buildDeliveryStages` in @cc/domain from the
 * delivery's canonical status, so the list and the detail screen cannot come
 * to disagree about how far along a consignment is (CLAUDE.md rule 3).
 *
 * Below `md` it turns vertical rather than scrolling sideways — doc 05 §5
 * makes delivery tracking a mobile-priority task, and a horizontally
 * scrolling stepper on a phone hides the very stage the customer opened the
 * screen to see.
 */

export interface DeliveryTrackerProps {
  stages: readonly DeliveryStage[];
  /** Compact variant for a table row or a card; hides the labels' spacing. */
  dense?: boolean;
  className?: string;
}

export function DeliveryTracker({ stages, dense = false, className }: DeliveryTrackerProps) {
  return (
    <ol
      aria-label="Shipment progress"
      className={cn(
        "flex flex-col md:flex-row",
        dense ? "gap-2 md:gap-0" : "gap-3 md:gap-0",
        className,
      )}
    >
      {stages.map((stage, index) => {
        // Three states, and each one carries an icon and a label as well as a
        // colour — status is never conveyed by colour alone (docs/05 §9).
        const Icon = stage.current ? Truck : stage.reached ? Check : CircleDashed;

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
                  stage.reached && !stage.current && "bg-accent-delivery",
                )}
              />
            ) : null}

            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 md:mx-auto",
                stage.current
                  ? "border-accent-delivery bg-accent-delivery text-white"
                  : stage.reached
                    ? "border-accent-delivery bg-accent-delivery/10 text-accent-delivery"
                    : "border-border-strong bg-surface text-text-dim",
              )}
            >
              <Icon aria-hidden className="size-3" strokeWidth={2.25} />
            </span>

            <p
              className={cn(
                "min-w-0 text-[11px] font-semibold uppercase tracking-[0.5px] md:mt-2 md:px-1 md:text-center",
                stage.current
                  ? "text-accent-delivery"
                  : stage.reached
                    ? "text-text-mid"
                    : "text-text-dim",
              )}
            >
              {stage.label}
              {stage.current ? <span className="sr-only"> (current stage)</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
