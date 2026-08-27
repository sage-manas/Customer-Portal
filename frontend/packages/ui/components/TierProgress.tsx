import type { LoyaltyStanding, LoyaltyTier } from "@cc/domain";
import { Award } from "lucide-react";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

import { Money } from "./Money";

/**
 * Loyalty tier card (docs/05-UI-UX-DESIGN.md §7.9: "tier card
 * (Bronze/Silver/Gold/Platinum) with progress bar to next threshold, YTD
 * purchase (from VBRK, FY-aware)").
 *
 * It decides nothing. `loyaltyStanding()` in @cc/domain places the account on
 * the tenant's ladder and computes what the next tier costs, so a tenant that
 * edits its thresholds changes what every screen says at once and none of them
 * can hold a stale idea of who is Gold (CLAUDE.md rule 3).
 *
 * The tier names are rendered with their own colours *and* their label, never
 * colour alone — "Gold" is a word here, not a shade (docs/05 §9).
 */

export interface TierProgressProps {
  standing: LoyaltyStanding;
  /** "FY 2026-27" — the year the purchases were counted over. */
  fiscalYearLabel: string;
  /** Compact form for the dashboard hero band: the chip and the bar. */
  compact?: boolean;
  className?: string;
}

/**
 * Metal colours, deliberately hand-picked rather than taken from the status
 * palette: a tier is not a status, and rendering Platinum in the "success"
 * green would make it read as an outcome rather than a standing.
 */
const TIER_STYLE: Record<LoyaltyTier, { chip: string; bar: string }> = {
  bronze: { chip: "bg-[#7c4a21]/10 text-[#7c4a21] ring-[#7c4a21]/20", bar: "bg-[#a1662f]" },
  silver: { chip: "bg-[#5b6472]/10 text-[#5b6472] ring-[#5b6472]/20", bar: "bg-[#8d98a7]" },
  gold: { chip: "bg-[#8a6300]/10 text-[#8a6300] ring-[#8a6300]/20", bar: "bg-[#d0a215]" },
  platinum: {
    chip: "bg-accent-loyalty/10 text-accent-loyalty ring-accent-loyalty/20",
    bar: "bg-accent-loyalty",
  },
};

export function TierProgress({
  standing,
  fiscalYearLabel,
  compact = false,
  className,
}: TierProgressProps) {
  const style = TIER_STYLE[standing.tier.key];
  const { nextTier } = standing;

  return (
    <section className={cn("space-y-3", className)} aria-label="Loyalty tier">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-bold ring-1 ring-inset",
            style.chip,
          )}
        >
          <Award aria-hidden className="size-3.5" strokeWidth={2.25} />
          {standing.tier.label}
        </span>
        <p className="text-[11.5px] text-text-dim">
          <Money value={standing.ytdValue} className="text-[11.5px] font-semibold" /> in{" "}
          {fiscalYearLabel}
        </p>
      </div>

      {compact ? null : <p className="text-[12.5px] text-text-mid">{standing.tier.blurb}</p>}

      <div>
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-background"
          role="img"
          aria-label={
            nextTier
              ? `${standing.progressPercent}% of the way to ${nextTier.label}`
              : `${standing.tier.label} — the top tier`
          }
        >
          <span
            className={cn("block h-full transition-[width] duration-moderate", style.bar)}
            style={{ width: `${standing.progressPercent}%` }}
          />
        </div>

        <p className="mt-1.5 text-[11.5px] text-text-dim">
          {nextTier ? (
            <>
              <Money
                value={standing.amountToNextTier}
                className="text-[11.5px] font-semibold text-text-mid"
              />{" "}
              more this year to reach {nextTier.label}
            </>
          ) : (
            "You're on our top tier."
          )}
        </p>
      </div>
    </section>
  );
}

/** The tier is computed from a VBRK read, so it has a real loading state. */
export function TierProgressSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <Skeleton className="h-7 w-28 rounded-full" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-2.5 w-full rounded-full" />
    </div>
  );
}
