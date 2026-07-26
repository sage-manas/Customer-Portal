import type { Meta, StoryObj } from "@storybook/react";
import { CreditCard, Headphones, Package, Receipt } from "lucide-react";

import { KpiCard, KpiCardSkeleton } from "./KpiCard";
import { Money } from "./Money";

const meta: Meta<typeof KpiCard> = {
  title: "Domain/KpiCard",
  component: KpiCard,
};
export default meta;

type Story = StoryObj<typeof KpiCard>;

export const Default: Story = {
  args: {
    label: "Open Orders",
    value: "7",
    subline: <Money value={1842500} />,
    icon: Package,
    accent: "order",
    href: "/orders?status=open",
  },
};

export const WithTrend: Story = {
  args: {
    label: "YTD Purchases",
    value: <Money value={14820000} />,
    subline: "FY 2026-27",
    icon: Receipt,
    accent: "invoice",
    trend: { direction: "up", label: "12% vs last FY" },
  },
};

export const Loading: StoryObj = { render: () => <KpiCardSkeleton /> };

export const Empty: Story = {
  args: {
    label: "Open Tickets",
    value: "0",
    subline: "Nothing needs your attention",
    icon: Headphones,
    accent: "support",
  },
};

/** The dashboard KPI row (docs/05 §7.0): four cards, module accents. */
export const DashboardRow: StoryObj = {
  render: () => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Open Orders"
        value="7"
        subline={<Money value={1842500} />}
        icon={Package}
        accent="order"
      />
      <KpiCard
        label="Pending Invoices"
        value="3"
        subline={<Money value={831123} />}
        icon={Receipt}
        accent="invoice"
      />
      <KpiCard
        label="Available Credit"
        value={<Money value={3157500} />}
        subline="63% of ₹ 50,00,000 utilised"
        icon={CreditCard}
        accent="payment"
      />
      <KpiCard
        label="Open Tickets"
        value="1"
        subline="SLA: 6h remaining"
        icon={Headphones}
        accent="support"
      />
    </div>
  ),
};
