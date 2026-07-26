import type { ModuleAccent } from "@cc/domain";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

/**
 * Dashboard KPI tile (docs/05-UI-UX-DESIGN.md §3.2): icon tile + label +
 * big value + sub-line + trend, with a corner accent wash in the owning
 * module's accent colour. Each card clicks through to its module with the
 * filter pre-applied (docs/05 §7.0), so `href` is the normal case.
 */

export interface KpiCardProps {
  label: string;
  /** Pre-formatted; use <Money> for currency so grouping stays consistent. */
  value: React.ReactNode;
  subline?: React.ReactNode;
  icon?: LucideIcon;
  accent?: ModuleAccent;
  trend?: { direction: "up" | "down"; label: string };
  href?: string;
  className?: string;
}

const ACCENT_TEXT: Record<ModuleAccent, string> = {
  onboard: "text-accent-onboard",
  catalog: "text-accent-catalog",
  inquiry: "text-accent-inquiry",
  order: "text-accent-order",
  delivery: "text-accent-delivery",
  invoice: "text-accent-invoice",
  payment: "text-accent-payment",
  support: "text-accent-support",
  loyalty: "text-accent-loyalty",
  report: "text-accent-report",
};

const ACCENT_WASH: Record<ModuleAccent, string> = {
  onboard: "from-accent-onboard/10",
  catalog: "from-accent-catalog/10",
  inquiry: "from-accent-inquiry/10",
  order: "from-accent-order/10",
  delivery: "from-accent-delivery/10",
  invoice: "from-accent-invoice/10",
  payment: "from-accent-payment/10",
  support: "from-accent-support/10",
  loyalty: "from-accent-loyalty/10",
  report: "from-accent-report/10",
};

export function KpiCard({
  label,
  value,
  subline,
  icon: Icon,
  accent,
  trend,
  href,
  className,
}: KpiCardProps) {
  const Wrapper = href ? "a" : "div";
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        "relative block overflow-hidden rounded-md border border-border bg-surface p-5 shadow-sm",
        href &&
          "transition-colors duration-micro ease-portal hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-0 top-0 size-24 bg-gradient-to-bl to-transparent",
            ACCENT_WASH[accent],
          )}
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">{label}</p>
        {Icon ? (
          <Icon
            aria-hidden
            className={cn("size-5 shrink-0", accent ? ACCENT_TEXT[accent] : "text-text-dim")}
            strokeWidth={1.75}
          />
        ) : null}
      </div>

      <p className="relative mt-2 text-xl font-bold text-text">{value}</p>

      <div className="relative mt-1 flex items-center gap-2 text-[11px] text-text-dim">
        {subline}
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              trend.direction === "up" ? "text-success" : "text-danger",
            )}
          >
            <TrendIcon aria-hidden className="size-3" />
            {trend.label}
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}

/** Loading state — dashboards must ship one (docs/05 §3.3). */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-surface p-5 shadow-sm", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}
