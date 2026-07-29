"use client";

import { LOCALE, CURRENCY_SYMBOL } from "@cc/config/constants";
import { CircleAlert, Table2, TrendingUp } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../lib/cn";
import { Skeleton } from "../primitives/skeleton";

/**
 * The frame every chart on `/reports` sits in (docs/05 §7.10: "All widgets:
 * skeleton, empty, error states; data-as-of timestamp").
 *
 * It carries the two things doc 05 asks for and a chart library will not
 * give you:
 *
 * 1. **A data-table fallback toggle** (§9, accessibility): "charts get a
 *    data-table fallback toggle". A bar chart is a picture to a screen
 *    reader, so every chart here can be read as a real `<table>` instead,
 *    and the toggle is a button rather than a hover affordance.
 * 2. **The four states.** A chart that renders an empty grid when the load
 *    failed is indistinguishable from a customer who bought nothing, and
 *    those two answers must never look alike.
 */

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Right-hand slot: a value/quantity toggle, a period select. */
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string;
  /** True when there is genuinely nothing to plot — a different answer. */
  empty?: boolean;
  emptyMessage?: string;
  /** The accessible table shown when the reader flips the toggle. */
  table?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  actions,
  loading = false,
  error,
  empty = false,
  emptyMessage = "Nothing to show for this period.",
  table,
  children,
  className,
}: ChartCardProps) {
  const [asTable, setAsTable] = useState(false);
  const bodyId = useId();

  return (
    <section
      className={cn("rounded-md border border-border bg-surface shadow-sm", className)}
      aria-label={title}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-bold text-text">{title}</h2>
          {subtitle ? <p className="text-[11.5px] text-text-dim">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table ? (
            <button
              type="button"
              onClick={() => {
                setAsTable((value) => !value);
              }}
              aria-pressed={asTable}
              aria-controls={bodyId}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px] font-medium text-text-mid transition-colors duration-micro hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {asTable ? (
                <TrendingUp aria-hidden className="size-3.5" />
              ) : (
                <Table2 aria-hidden className="size-3.5" />
              )}
              {asTable ? "Chart" : "Table"}
            </button>
          ) : null}
        </div>
      </header>

      <div id={bodyId} className="p-4">
        {loading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : error ? (
          <p
            role="alert"
            className="flex items-center justify-center gap-2 rounded-md border border-danger-border bg-danger-subtle px-4 py-16 text-center text-[12.5px] text-danger"
          >
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            {error}
          </p>
        ) : empty ? (
          <p className="px-4 py-16 text-center text-[12.5px] text-text-dim">{emptyMessage}</p>
        ) : asTable ? (
          <div className="overflow-x-auto">{table}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * Axis and tooltip money formatting. Full `Money` grouping is unreadable on
 * a Y axis, so amounts collapse to the Indian units a reader expects — lakh
 * and crore, not K and M (docs/05 §11: en-IN throughout).
 */
export function formatCompactInr(value: number, withSymbol = true): string {
  const prefix = withSymbol ? `${CURRENCY_SYMBOL} ` : "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 10_000_000) return `${sign}${prefix}${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}${prefix}${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}${prefix}${trim(abs / 1_000)}K`;
  return `${sign}${prefix}${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(abs)}`;
}

function trim(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

/** Shared axis/grid styling, so three charts cannot drift apart. */
export const CHART_AXIS = {
  tick: { fill: "var(--color-text-dim)", fontSize: 11 },
  axisLine: { stroke: "var(--color-border)" },
  tickLine: false,
} as const;

export const CHART_GRID_STROKE = "var(--color-border)";

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
  labelStyle: { color: "var(--color-text)", fontWeight: 600 },
} as const;
