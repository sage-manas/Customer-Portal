import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "../primitives/button";

/**
 * Multi-step form frame (docs/05-UI-UX-DESIGN.md §3.2 `WizardShell`): step
 * indicator, per-step content, Save Draft, Back/Continue.
 *
 * Presentational on purpose — it owns no form state. Validation, autosave
 * and the exit guard belong to the page that knows what a step *means*;
 * this component knows only how many steps there are, which one is showing,
 * and which ones are already complete. Onboarding is its first consumer;
 * any later wizard reuses it unchanged.
 */

export interface WizardStep {
  key: string;
  title: string;
  /** Rendered under the title on the current step. */
  description?: string;
}

export interface WizardShellProps {
  steps: readonly WizardStep[];
  /** 1-based. */
  current: number;
  /** 1-based step numbers the user has completed. */
  completed?: readonly number[];
  onBack?: () => void;
  onContinue?: () => void;
  onSaveDraft?: () => void;
  onStepSelect?: (step: number) => void;
  /** Disables navigation while a save/submit is in flight. */
  busy?: boolean;
  /** Overrides the Continue label on the last step ("Submit application"). */
  continueLabel?: string;
  /** ISO timestamp of the last successful save, for the autosave hint. */
  lastSavedAt?: string;
  /** Doc-level error card above the fields (docs/05 §6.2). */
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function WizardShell({
  steps,
  current,
  completed = [],
  onBack,
  onContinue,
  onSaveDraft,
  onStepSelect,
  busy = false,
  continueLabel,
  lastSavedAt,
  error,
  children,
  className,
}: WizardShellProps) {
  const step = steps[current - 1];
  const isLast = current === steps.length;

  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <ol
        className="flex flex-wrap items-center gap-2"
        aria-label={`Step ${current} of ${steps.length}`}
      >
        {steps.map((item, index) => {
          const number = index + 1;
          const isCurrent = number === current;
          const isDone = completed.includes(number);
          const reachable = Boolean(onStepSelect) && (isDone || number < current);

          return (
            <li key={item.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={reachable ? () => onStepSelect?.(number) : undefined}
                disabled={!reachable || busy}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-micro",
                  isCurrent
                    ? "border-primary bg-primary-subtle text-primary"
                    : isDone
                      ? "border-success-border bg-success-subtle text-success"
                      : "border-border bg-surface text-text-dim",
                  reachable && !isCurrent && "hover:bg-primary-subtle",
                  !reachable && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-pill text-[10px] font-bold",
                    isCurrent
                      ? "bg-primary text-white"
                      : isDone
                        ? "bg-success text-white"
                        : "bg-border text-text-mid",
                  )}
                >
                  {/* Completion is never colour-only (docs/05 §9). */}
                  {isDone && !isCurrent ? <Check aria-hidden className="size-3" /> : number}
                </span>
                {item.title}
                {isDone && !isCurrent ? <span className="sr-only">(completed)</span> : null}
              </button>
              {index < steps.length - 1 ? (
                <span aria-hidden className="h-px w-4 bg-border-strong" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <header className="border-b border-border px-6 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Step {current} of {steps.length}
          </p>
          <h2 className="mt-0.5 text-[18px] font-bold text-text">{step?.title}</h2>
          {step?.description ? (
            <p className="mt-1 text-[12.5px] text-text-dim">{step.description}</p>
          ) : null}
        </header>

        {error ? (
          <div
            role="alert"
            aria-live="polite"
            className="border-b border-danger-border bg-danger-subtle px-6 py-3 text-[12.5px] text-danger"
          >
            {error}
          </div>
        ) : null}

        <div className="px-6 py-5">{children}</div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-border bg-background px-6 py-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onBack}
            disabled={busy || current === 1 || !onBack}
          >
            Back
          </Button>

          {onSaveDraft ? (
            <Button type="button" variant="ghost" onClick={onSaveDraft} disabled={busy}>
              Save draft
            </Button>
          ) : null}

          <span aria-live="polite" className="text-[11px] text-text-dim">
            {busy ? "Saving…" : lastSavedAt ? `Draft saved ${formatTime(lastSavedAt)}` : null}
          </span>

          <Button
            type="button"
            className="ml-auto"
            onClick={onContinue}
            loading={busy}
            disabled={!onContinue}
          >
            {continueLabel ?? (isLast ? "Submit" : "Save & continue")}
          </Button>
        </footer>
      </div>
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Form section header (docs/05 §2.1 "Section label" type style, §5 3-column
 * grid). Every wizard step is a stack of these.
 */
export interface FormSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({ title, children, className }: FormSectionProps) {
  return (
    <fieldset className={cn("mb-6 last:mb-0", className)}>
      <legend className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </fieldset>
  );
}
