import type { CanonicalStatus } from "@cc/domain/status";
import type { Meta, StoryObj } from "@storybook/react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "../primitives/button";

import { DataTable } from "./DataTable";
import { Money } from "./Money";
import { StatusBadge } from "./StatusBadge";

interface OrderRow {
  soNumber: string;
  customer: string;
  value: number;
  status: CanonicalStatus;
}

const columns: ColumnDef<OrderRow, unknown>[] = [
  { accessorKey: "soNumber", header: "Order" },
  { accessorKey: "customer", header: "Customer" },
  {
    accessorKey: "value",
    header: "Value",
    cell: (info) => <Money value={info.getValue() as number} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue() as CanonicalStatus} />,
  },
];

const sampleData: OrderRow[] = [
  { soNumber: "SO-2025-1841", customer: "Acme Distributors", value: 480000, status: "Confirmed" },
  { soNumber: "SO-2025-1842", customer: "Bharat Traders", value: 125000, status: "CreditHold" },
  {
    soNumber: "SO-2025-1843",
    customer: "City Hardware",
    value: 62000,
    status: "PartiallyDelivered",
  },
];

const meta: Meta<typeof DataTable<OrderRow>> = {
  title: "Domain/DataTable",
  component: DataTable,
};
export default meta;

type Story = StoryObj<typeof DataTable<OrderRow>>;

export const Default: Story = { args: { columns, data: sampleData } };
export const Loading: Story = { args: { columns, data: [], loading: true } };
export const Empty: Story = {
  args: {
    columns,
    data: [],
    emptyMessage: "No open orders",
    emptyAction: <Button size="sm">Browse catalogue</Button>,
  },
};
export const ErrorState: Story = {
  args: { columns, data: [], error: "Couldn't load orders. SAP may be unreachable." },
};
export const Paginated: Story = {
  args: { columns, data: sampleData, pageCount: 4, pageIndex: 1, onPageChange: () => {} },
};
