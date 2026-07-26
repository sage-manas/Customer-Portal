import type { SessionClaims } from "@cc/domain";
import { ADMIN_NAV, PORTAL_NAV, visibleNavItems } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { KpiCard } from "../components/KpiCard";
import { SapSyncIndicator, StaleDataBanner } from "../components/SapSyncIndicator";

import { AppShell, PageHeader } from "./AppShell";

const meta: Meta<typeof AppShell> = {
  title: "Layout/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

const buyer: Pick<SessionClaims, "roles"> = { roles: ["buyer_user"] };

const baseArgs = {
  tenantName: "Acme Industrials",
  userEmail: "rohit@sharmaindustrials.example",
  accounts: [
    { kunnr: "0010001001", label: "Sharma Industrial Supplies Pvt Ltd" },
    { kunnr: "0010001002", label: "Sharma Industrials — Chakan" },
  ],
  activeKunnr: "0010001001",
  notificationCount: 3,
  onSearch: () => undefined,
  onSignOut: () => undefined,
};

export const CustomerPortal: Story = {
  args: {
    ...baseArgs,
    navItems: visibleNavItems([...PORTAL_NAV], buyer),
    pathname: "/",
    children: (
      <>
        <PageHeader
          title="Dashboard"
          subtitle="Your order-to-cash position at a glance."
          meta={<SapSyncIndicator state="live" />}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Open Orders" value="7" accent="order" />
          <KpiCard label="Pending Invoices" value="3" accent="invoice" />
          <KpiCard label="Available Credit" value="₹ 31,57,500" accent="payment" />
          <KpiCard label="Open Tickets" value="1" accent="support" />
        </div>
      </>
    ),
  },
};

/** Same shell, back-office nav (docs/05 §8). */
export const TenantBackOffice: Story = {
  args: {
    ...baseArgs,
    userEmail: "credit.team@acme.example",
    accounts: [],
    navItems: visibleNavItems([...ADMIN_NAV], { roles: ["tenant_admin"] }),
    pathname: "/admin/credit",
    children: <PageHeader title="Credit Release" subtitle="Orders blocked on credit." />,
  },
};

/** SAP unreachable: banner above content, stale indicator in the header. */
export const SapOutage: Story = {
  args: {
    ...baseArgs,
    navItems: visibleNavItems([...PORTAL_NAV], buyer),
    pathname: "/orders",
    banner: <StaleDataBanner syncedAt="2026-07-26T09:42:00.000Z" onRetry={() => undefined} />,
    children: <PageHeader title="Orders" meta={<SapSyncIndicator state="stale" />} />,
  },
};

/** A view-only buyer sees fewer nav entries and no write CTAs. */
export const ViewOnlyBuyer: Story = {
  args: {
    ...baseArgs,
    navItems: visibleNavItems([...PORTAL_NAV], { roles: ["buyer_view_only"] }),
    pathname: "/invoices",
    children: (
      <PageHeader
        title="Invoices"
        meta={<SapSyncIndicator state="cached" syncedAt={new Date().toISOString()} />}
      />
    ),
  },
};
