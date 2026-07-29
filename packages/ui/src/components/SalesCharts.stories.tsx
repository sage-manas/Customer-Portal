import type { MonthBucket, ProductRow } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { AovTrendChart, OrdersByMonthChart, TopProductsChart } from "./SalesCharts";

/**
 * Docs/05 §12.3: a screen isn't done until its loading, empty and error
 * states exist in Storybook. For a chart that matters more than usual —
 * an empty grid and a failed load look identical unless someone drew them
 * apart on purpose.
 */

const MONTHS: MonthBucket[] = [
  { key: "2025-08", label: "Aug 25", orderCount: 2, value: 908000, averageOrderValue: 454000 },
  { key: "2025-09", label: "Sep 25", orderCount: 1, value: 636563, averageOrderValue: 636563 },
  { key: "2025-10", label: "Oct 25", orderCount: 1, value: 271400, averageOrderValue: 271400 },
  { key: "2025-11", label: "Nov 25", orderCount: 0, value: 0, averageOrderValue: 0 },
  { key: "2025-12", label: "Dec 25", orderCount: 1, value: 449143, averageOrderValue: 449143 },
  { key: "2026-01", label: "Jan 26", orderCount: 1, value: 174640, averageOrderValue: 174640 },
  { key: "2026-02", label: "Feb 26", orderCount: 0, value: 0, averageOrderValue: 0 },
  { key: "2026-03", label: "Mar 26", orderCount: 1, value: 848750, averageOrderValue: 848750 },
  { key: "2026-04", label: "Apr 26", orderCount: 1, value: 217120, averageOrderValue: 217120 },
  { key: "2026-05", label: "May 26", orderCount: 1, value: 594125, averageOrderValue: 594125 },
  { key: "2026-06", label: "Jun 26", orderCount: 2, value: 685193, averageOrderValue: 342597 },
  { key: "2026-07", label: "Jul 26", orderCount: 3, value: 1188000, averageOrderValue: 396000 },
];

const PRODUCTS: ProductRow[] = [
  {
    material: "MAT-10001",
    description: "Hydraulic Pump HP-200",
    quantity: 70,
    uom: "EA",
    value: 2970625,
    orderCount: 5,
  },
  {
    material: "MAT-20002",
    description: "Seamless Steel Pipe 4in Sch40",
    quantity: 450,
    uom: "M",
    value: 488520,
    orderCount: 2,
  },
  {
    material: "MAT-50001",
    description: "Pressure Gauge 0-16 bar",
    quantity: 80,
    uom: "EA",
    value: 174640,
    orderCount: 1,
  },
  {
    material: "MAT-30001",
    description: "Nitrile Gasket Set 150mm",
    quantity: 208,
    uom: "SET",
    value: 170310,
    orderCount: 2,
  },
];

const meta = {
  title: "Reports/SalesCharts",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

export const OrdersByMonth: StoryObj = {
  render: () => <OrdersByMonthChart buckets={MONTHS} />,
};

/** Nov and Feb are empty on purpose — the gap is the finding, not noise. */
export const OrdersByMonthWithGaps: StoryObj = {
  render: () => <OrdersByMonthChart buckets={MONTHS} />,
};

export const OrdersByMonthLoading: StoryObj = {
  render: () => <OrdersByMonthChart buckets={[]} loading />,
};

export const OrdersByMonthError: StoryObj = {
  render: () => (
    <OrdersByMonthChart
      buckets={[]}
      error="We couldn't reach SAP to build this chart. Try again in a moment."
    />
  ),
};

export const TopProducts: StoryObj = {
  render: () => <TopProductsChart rows={PRODUCTS} />,
};

export const TopProductsEmpty: StoryObj = {
  render: () => <TopProductsChart rows={[]} />,
};

export const AovTrend: StoryObj = {
  render: () => <AovTrendChart buckets={MONTHS} />,
};

/** A month with no orders has no average; the line breaks rather than dips. */
export const AovTrendWithGaps: StoryObj = {
  render: () => (
    <AovTrendChart
      buckets={MONTHS.map((month, index) =>
        index === 3 || index === 6 ? { ...month, orderCount: 0, averageOrderValue: 0 } : month,
      )}
    />
  ),
};
