import { Check, X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Pass/fail gate (docs/05-UI-UX-DESIGN.md §3.2 `DecisionGate`), the pattern
 * the reference uses wherever a process forks: credit released vs blocked,
 * approved vs rejected, delivered vs discrepancy.
 *
 * Used on approval screens to show, at a glance, which checks a submission
 * has actually passed — the reviewer decides, but they decide against
 * evidence rather than against a wall of fields.
 */

export interface DecisionGateItem {
  label: string;
  passed: boolean;
  /** Why it failed (or what passed), one line. */
  detail?: string;
}

export interface DecisionGateProps {
  title?: string;
  items: readonly DecisionGateItem[];
  className?: string;
}

export function DecisionGate({ title, items, className }: DecisionGateProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {title ? (
        <h3 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
          {title}
        </h3>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              "flex items-start gap-2 rounded-sm border px-2.5 py-1.5 text-[12px]",
              item.passed
                ? "border-success-border bg-success-subtle text-success"
                : "border-danger-border bg-danger-subtle text-danger",
            )}
          >
            {/* Icon + label, never colour alone (docs/05 §9). */}
            {item.passed ? (
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <X aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="font-medium">{item.label}</span>
              <span className="sr-only">{item.passed ? " — passed" : " — failed"}</span>
              {item.detail ? (
                <span className="block text-[11px] opacity-90">{item.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
