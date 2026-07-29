import type { CreditBand, CreditPosition } from "@cc/domain";
import { AlertTriangle, Ban, CheckCircle2, TrendingUp } from "lucide-react";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

import { Money } from "./Money";

/**
 * Credit position gauge (docs/05-UI-UX-DESIGN.md §7.9: "gauge/donut — limit
 * KLIMK, utilized SKFOR, available (computed); credit status; DSO metric;
 * utilization >80% amber, >95% danger with 'orders may be blocked' warning").
 *
 * It decides nothing. `creditPosition()` in @cc/domain computes the band, the
 * percentage and the message, so this screen, the dashboard KPI and any future
 * warning banner cannot disagree about whether a customer is close to their
 * limit (CLAUDE.md rule 3). In particular the thresholds are *not* here — a
 * component that knew what 95% meant would be a second place to change it.
 *
 * Every band carries an icon and a sentence as well as a colour: an amber arc
 * and a red arc are the same arc to a colour-blind reader, and "your orders may
 * be blocked" is not a detail (docs/05 §9).
 */

export interface CreditGaugeProps {
  position: CreditPosition;
  /** Compact form for a dashboard tile: the arc and the headline, no table. */
  compact?: boolean;
  className?: string;
}

const BAND: Record<
  CreditBand,
  { arc: string; text: string; Icon: typeof CheckCircle2; label: string }
> = {
  healthy: { arc: "stroke-success", text: "text-success", Icon: CheckCircle2, label: "Healthy" },
  warning: { arc: "stroke-warning", text: "text-warning", Icon: AlertTriangle, label: "High use" },
  critical: { arc: "stroke-danger", text: "text-danger", Icon: AlertTriangle, label: "Near limit" },
  blocked: { arc: "stroke-danger", text: "text-danger", Icon: Ban, label: "On hold" },
};

/** Geometry of the donut. A three-quarter arc, so the gap reads as a dial. */
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SWEEP = 0.75;

export function CreditGauge({ position, compact = false, className }: CreditGaugeProps) {
  const { arc, text, Icon, label } = BAND[position.band];
  // The arc is capped at a full sweep: an account over its limit is at 100% of
  // the dial, not 108% of it, and the number beside it still says 108%.
  const filled = Math.min(1, Math.max(0, position.utilizationRatio));

  return (
    <section
      className={cn("flex flex-wrap items-center gap-6", className)}
      aria-label="Credit position"
    >
      <div className="relative shrink-0">
        <svg viewBox="0 0 128 128" className="size-32 -rotate-[225deg]" role="img" aria-hidden>
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            className="stroke-background"
            strokeDasharray={`${CIRCUMFERENCE * SWEEP} ${CIRCUMFERENCE}`}
          />
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            className={cn(arc, "transition-[stroke-dasharray] duration-moderate")}
            strokeDasharray={`${CIRCUMFERENCE * SWEEP * filled} ${CIRCUMFERENCE}`}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-[22px] font-bold tabular-nums", text)}>
            {position.utilizationPercent}%
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.8px] text-text-dim">utilised</span>
        </div>
      </div>

      <div className="min-w-[12rem] flex-1 space-y-3">
        <p className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", text)}>
          <Icon aria-hidden className="size-4" strokeWidth={2.25} />
          {label}
        </p>
        {/* The domain layer's sentence, rendered as-is (docs/05 §11). */}
        <p className="text-[12.5px] text-text-mid">{position.message}</p>

        {compact ? null : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
            <Figure label="Approved limit" value={<Money value={position.creditLimit} />} />
            <Figure label="Utilised" value={<Money value={position.utilized} />} />
            <Figure
              label="Available"
              value={
                <Money
                  value={position.available}
                  className={position.available < 0 ? "font-semibold text-danger" : "font-semibold"}
                />
              }
            />
            <Figure
              label={`DSO (${position.dsoPeriodDays}-day)`}
              value={
                position.dso === null ? (
                  // No billing in the window is not "pays instantly" — the
                  // domain returns null and the screen says so rather than
                  // printing a zero somebody would act on.
                  <span
                    className="text-text-dim"
                    title="No billing in the period to measure against"
                  >
                    —
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <TrendingUp aria-hidden className="size-3.5 text-text-dim" />
                    {position.dso} days
                  </span>
                )
              }
            />
          </dl>
        )}
      </div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

/** KNKK is a per-customer SAP call, so the gauge has a real loading state. */
export function CreditGaugeSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <Skeleton className="size-32 rounded-full" />
      <div className="min-w-[12rem] flex-1 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
