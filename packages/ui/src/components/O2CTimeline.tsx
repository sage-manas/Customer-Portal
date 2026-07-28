import type { O2CStage } from "@cc/domain";
import { Check, CircleDashed, CircleSlash, Clock } from "lucide-react";

import { cn } from "../lib/cn";
import { formatDisplayDate } from "../lib/relative-time";

import { DocumentNumber } from "./DocumentNumber";
import { StatusBadge } from "./StatusBadge";

/**
 * The O2C spine (docs/05-UI-UX-DESIGN.md §3.2): "Horizontal stepper: Order →
 * Credit Check → Delivery → Invoice → Payment, with per-step status, dates,
 * and doc-number links. Rendered on every document detail page."
 *
 * It decides nothing. The stages, their statuses, their dates and their
 * document links are all computed by `buildO2CTimeline` in @cc/domain from
 * what SAP actually returned, so the same chain reads identically from an
 * order, a delivery or an invoice (CLAUDE.md rule 3).
 *
 * Below `md` the stepper turns vertical rather than scrolling sideways — on
 * a phone this is a status list, and doc 05 §5 makes delivery tracking a
 * mobile-priority task.
 */

export interface O2CTimelineProps {
  stages: readonly O2CStage[];
  /** The stage the current document *is*, drawn as the anchor of the chain. */
  currentStage?: O2CStage["key"];
  className?: string;
}

/** A stage with no status has not been reached; one that blocks is `CreditHold`. */
function stageTone(stage: O2CStage): "done" | "current" | "blocked" | "pending" {
  if (stage.status === null) return "pending";
  if (stage.status === "CreditHold" || stage.status === "Overdue" || stage.status === "Rejected") {
    return "blocked";
  }
  if (
    stage.status === "Delivered" ||
    stage.status === "Paid" ||
    stage.status === "Cleared" ||
    stage.status === "Closed" ||
    stage.status === "Confirmed"
  ) {
    return "done";
  }
  return "current";
}

const MARKER_CLASS: Record<ReturnType<typeof stageTone>, string> = {
  done: "border-success bg-success text-white",
  current: "border-info bg-info-subtle text-info",
  blocked: "border-danger bg-danger text-white",
  pending: "border-border-strong bg-surface text-text-dim",
};

export function O2CTimeline({ stages, currentStage, className }: O2CTimelineProps) {
  return (
    <section
      aria-label="Order to cash progress"
      className={cn(
        "rounded-md border border-border bg-surface p-4 shadow-sm md:px-5 md:py-5",
        className,
      )}
    >
      <ol className="flex flex-col gap-4 md:flex-row md:gap-0">
        {stages.map((stage, index) => {
          const tone = stageTone(stage);
          const Icon =
            tone === "done"
              ? Check
              : tone === "blocked"
                ? CircleSlash
                : tone === "current"
                  ? Clock
                  : CircleDashed;

          return (
            <li
              key={stage.key}
              aria-current={currentStage === stage.key ? "step" : undefined}
              className="relative flex flex-1 gap-3 md:flex-col md:gap-0"
            >
              {/* Connector: horizontal between markers on desktop, vertical
                  down the gutter on mobile. Never the only cue — every stage
                  carries its own icon and label (docs/05 §9). */}
              {index < stages.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bg-border",
                    "left-[13px] top-8 h-[calc(100%-1rem)] w-px md:left-auto md:top-[13px] md:h-px md:w-full md:translate-x-[calc(50%+14px)]",
                    tone === "done" && "bg-success",
                  )}
                />
              ) : null}

              <span
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 md:mx-auto",
                  MARKER_CLASS[tone],
                )}
              >
                <Icon aria-hidden className="size-3.5" strokeWidth={2} />
              </span>

              <div className="min-w-0 pb-1 md:mt-2.5 md:px-2 md:text-center">
                <p
                  className={cn(
                    "text-[11.5px] font-bold uppercase tracking-[0.6px]",
                    tone === "pending" ? "text-text-dim" : "text-text-mid",
                  )}
                >
                  {stage.label}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 md:justify-center">
                  {stage.status ? (
                    <StatusBadge status={stage.status} />
                  ) : (
                    <span className="text-[11px] text-text-dim">Not started</span>
                  )}
                </div>

                {stage.date ? (
                  <p className="mt-1 text-[11px] tabular-nums text-text-dim">
                    {formatDisplayDate(stage.date)}
                  </p>
                ) : null}

                {stage.documents.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-2 md:justify-center">
                    {stage.documents.map((doc) => (
                      <DocumentNumber
                        key={doc.value}
                        value={doc.value}
                        href={doc.href}
                        className="text-[11px]"
                      />
                    ))}
                  </div>
                ) : null}

                {stage.note ? (
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      tone === "blocked" ? "text-danger" : "text-text-dim",
                    )}
                  >
                    {stage.note}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
