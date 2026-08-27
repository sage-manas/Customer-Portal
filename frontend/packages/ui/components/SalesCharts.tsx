"use client";

import type { MonthBucket, ProductRow } from "@cc/domain";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { moduleAccentTokens } from "../tokens";

import {
  CHART_AXIS,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_STYLE,
  ChartCard,
  formatCompactInr,
} from "./ChartCard";
import { Money } from "./Money";

/**
 * The three charts of docs/05 §7.10: orders by month, top products, AOV
 * trend. Recharts, "module-accent primary series, max 2 series per chart,
 * always labeled axes + INR formatting".
 *
 * Every one of them **renders an array the domain layer already shaped** —
 * `ordersByMonth`, `topProducts` and `aovTrend` in
 * `@cc/domain/entities/reporting`. None of these components filters by date,
 * sums a line or decides which month a document falls in. That is ADR-015's
 * rule for `O2CTimeline` and ADR-018's for `AmountAging`, and the reason
 * this file has no `reduce()` in it: the KPI tile above the chart and the
 * chart itself are fed by one function, so they cannot disagree.
 *
 * Each chart supplies its own `<table>` fallback (docs/05 §9) rather than
 * inheriting a generic one, because the right table for a bar chart of
 * months is not the right table for a product ranking.
 */

const ACCENT = moduleAccentTokens.report;

const CHART_HEIGHT = 260;

// ---- Orders by month ------------------------------------------------------

export type OrdersByMonthMeasure = "value" | "count";

export interface OrdersByMonthChartProps {
  buckets: readonly MonthBucket[];
  loading?: boolean;
  error?: string;
  className?: string;
}

export function OrdersByMonthChart({
  buckets,
  loading,
  error,
  className,
}: OrdersByMonthChartProps) {
  const [measure, setMeasure] = useState<OrdersByMonthMeasure>("value");
  const byValue = measure === "value";

  return (
    <ChartCard
      title="Orders by month"
      subtitle="VBAK creation date. Months with no orders are shown empty, not skipped."
      loading={loading}
      error={error}
      // A period in which nothing was ordered is a real finding, so the
      // chart still draws its empty months; "empty" here means no months.
      empty={buckets.length === 0}
      actions={
        <MeasureToggle
          value={measure}
          options={[
            { key: "value", label: "Value" },
            { key: "count", label: "Orders" },
          ]}
          onChange={setMeasure}
        />
      }
      table={
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Order value and count by month</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-3 py-2 font-bold">
                Month
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Orders
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-text-mid">
                  {bucket.label}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{bucket.orderCount}</td>
                <td className="px-3 py-2 text-right">
                  <Money value={bucket.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={[...buckets]} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" {...CHART_AXIS} />
          <YAxis
            {...CHART_AXIS}
            width={64}
            tickFormatter={(value: number) =>
              byValue ? formatCompactInr(value) : String(Math.round(value))
            }
          />
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={tooltipFormatter(byValue ? "Order value" : "Orders", (value) =>
              byValue ? formatCompactInr(value) : String(value),
            )}
          />
          <Bar
            dataKey={byValue ? "value" : "orderCount"}
            fill={ACCENT}
            radius={[3, 3, 0, 0]}
            maxBarSize={44}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---- Top products ---------------------------------------------------------

export type TopProductsMeasure = "value" | "quantity";

export interface TopProductsChartProps {
  rows: readonly ProductRow[];
  loading?: boolean;
  error?: string;
  className?: string;
}

export function TopProductsChart({ rows, loading, error, className }: TopProductsChartProps) {
  const [measure, setMeasure] = useState<TopProductsMeasure>("value");
  const byValue = measure === "value";

  /**
   * Ranked by value even when the bars show quantity. A material sold in
   * metres and one sold in each cannot be compared by quantity, so re-sorting
   * on the quantity toggle would put "1,250 M of hose" above "20 pumps" and
   * call it the top product.
   */
  const data = [...rows].map((row) => ({
    ...row,
    label: row.description ?? row.material,
  }));

  return (
    <ChartCard
      title="Top products"
      subtitle="Grouped from order lines (VBAP), ranked by value."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyMessage="No orders in this period, so there's nothing to rank."
      actions={
        <MeasureToggle
          value={measure}
          options={[
            { key: "value", label: "Value" },
            { key: "quantity", label: "Qty" },
          ]}
          onChange={setMeasure}
        />
      }
      table={
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Top products by order value</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-3 py-2 font-bold">
                Material
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Quantity
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Orders
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.material} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-text-mid">
                  {row.description ?? row.material}
                  <span className="ml-1 font-mono text-[11px] text-text-dim">{row.material}</span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.quantity} {row.uom}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                <td className="px-3 py-2 text-right">
                  <Money value={row.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height={Math.max(CHART_HEIGHT, data.length * 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} horizontal={false} />
          <XAxis
            type="number"
            {...CHART_AXIS}
            tickFormatter={(value: number) =>
              byValue ? formatCompactInr(value) : String(Math.round(value))
            }
          />
          <YAxis type="category" dataKey="label" {...CHART_AXIS} width={160} />
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={tooltipFormatter(byValue ? "Order value" : "Quantity", (value) =>
              byValue ? formatCompactInr(value) : String(value),
            )}
          />
          <Bar
            dataKey={byValue ? "value" : "quantity"}
            fill={ACCENT}
            radius={[0, 3, 3, 0]}
            maxBarSize={20}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---- Average order value --------------------------------------------------

export interface AovTrendChartProps {
  buckets: readonly MonthBucket[];
  loading?: boolean;
  error?: string;
  className?: string;
}

export function AovTrendChart({ buckets, loading, error, className }: AovTrendChartProps) {
  return (
    <ChartCard
      title="Average order value"
      subtitle="Mean value per order, by month."
      loading={loading}
      error={error}
      empty={buckets.length === 0}
      table={
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Average order value by month</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-3 py-2 font-bold">
                Month
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Average order value
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-text-mid">
                  {bucket.label}
                </th>
                <td className="px-3 py-2 text-right">
                  {bucket.orderCount > 0 ? (
                    <Money value={bucket.averageOrderValue} />
                  ) : (
                    <span className="text-text-dim">No orders</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart
          // A month with no orders has no average, and plotting it as zero
          // would draw a crash into the trend. `null` breaks the line, which
          // is the honest shape.
          data={buckets.map((bucket) => ({
            ...bucket,
            averageOrderValue: bucket.orderCount > 0 ? bucket.averageOrderValue : null,
          }))}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" {...CHART_AXIS} />
          <YAxis
            {...CHART_AXIS}
            width={64}
            tickFormatter={(value: number) => formatCompactInr(value)}
          />
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={tooltipFormatter("Average order value", formatCompactInr)}
          />
          <Line
            type="monotone"
            dataKey="averageOrderValue"
            stroke={ACCENT}
            strokeWidth={2}
            dot={{ r: 3, fill: ACCENT }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---- Shared -----------------------------------------------------------------

/**
 * Recharts types a tooltip value as `ValueType | undefined` (it can be a
 * string, an array, or missing), so the cast is done once here rather than
 * three times inline with three chances to get it wrong.
 */
function tooltipFormatter(
  label: string,
  format: (value: number) => string,
): (value: unknown) => [string, string] {
  return (value: unknown) => [format(Number(value ?? 0)), label];
}

interface MeasureToggleProps<T extends string> {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (value: T) => void;
}

function MeasureToggle<T extends string>({ value, options, onChange }: MeasureToggleProps<T>) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5" role="group">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => {
            onChange(option.key);
          }}
          className={
            value === option.key
              ? "rounded-[4px] bg-nav px-2 py-0.5 text-[11.5px] font-semibold text-white"
              : "rounded-[4px] px-2 py-0.5 text-[11.5px] font-medium text-text-mid hover:text-text"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
