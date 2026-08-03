import type { Cart } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { CartButton, CartDrawer } from "./CartDrawer";

const meta: Meta<typeof CartDrawer> = {
  title: "Domain/CartDrawer",
  component: CartDrawer,
};
export default meta;

const cart: Cart = {
  id: "cart-1",
  kunnr: "0010001001",
  lines: [
    {
      id: "line-1",
      material: "MAT-10001",
      description: "Hydraulic Pump HP-200",
      quantity: 2,
      uom: "EA",
      minimumOrderQty: 1,
      netPrice: 42500,
      lineValue: 85000,
      availableStock: 177,
      plant: "1000",
      issues: [],
      addedAt: new Date("2026-07-26T09:00:00Z"),
    },
    {
      id: "line-2",
      material: "MAT-10002",
      description: "Hydraulic Pump HP-400 Heavy Duty",
      quantity: 50,
      uom: "EA",
      minimumOrderQty: 1,
      netPrice: 78400,
      lineValue: 3920000,
      availableStock: 8,
      plant: "1000",
      issues: [
        {
          code: "insufficient_stock",
          message: "Only 8 EA available now — the rest follows on lead time.",
          severity: "warning",
        },
      ],
      addedAt: new Date("2026-07-26T09:05:00Z"),
    },
  ],
  netValue: 4005000,
  currency: "INR",
  hasBlockingIssues: false,
  priced: true,
  updatedAt: new Date("2026-07-26T09:05:00Z"),
};

const noop = () => {};

export const Default: StoryObj = {
  render: () => (
    <CartDrawer
      open
      onClose={noop}
      cart={cart}
      onQuantityChange={noop}
      onRemoveLine={noop}
      onCreateOrder={noop}
      onRequestQuote={noop}
    />
  ),
};

/** A below-MOQ line blocks Create Order — SAP would reject it at VA01 anyway. */
export const WithBlockingIssue: StoryObj = {
  render: () => (
    <CartDrawer
      open
      onClose={noop}
      cart={{
        ...cart,
        hasBlockingIssues: true,
        lines: [
          {
            ...cart.lines[0]!,
            material: "MAT-10003",
            description: "Control Valve CV-50 Brass",
            quantity: 2,
            minimumOrderQty: 5,
            issues: [
              { code: "below_moq", message: "Minimum order quantity is 5 EA", severity: "blocker" },
            ],
          },
        ],
      }}
      onQuantityChange={noop}
      onRemoveLine={noop}
      onCreateOrder={noop}
      onRequestQuote={noop}
    />
  ),
};

/** SAP unreachable: the cart still renders, unpriced, and quoting still works (docs/05 P7). */
export const Unpriced: StoryObj = {
  render: () => (
    <CartDrawer
      open
      onClose={noop}
      cart={{
        ...cart,
        priced: false,
        netValue: 0,
        lines: cart.lines.map((line) => ({
          ...line,
          netPrice: null,
          lineValue: null,
          availableStock: null,
          issues: [],
        })),
      }}
      onQuantityChange={noop}
      onRemoveLine={noop}
      onCreateOrder={noop}
      onRequestQuote={noop}
    />
  ),
};

export const Empty: StoryObj = {
  render: () => <CartDrawer open onClose={noop} cart={{ ...cart, lines: [], netValue: 0 }} />,
};

export const Loading: StoryObj = {
  render: () => <CartDrawer open onClose={noop} cart={null} loading />,
};

export const Error: StoryObj = {
  render: () => (
    <CartDrawer
      open
      onClose={noop}
      cart={null}
      error="We couldn't load your cart. Nothing was lost — try again in a moment."
      onRetry={noop}
    />
  ),
};

/** No `cart:manage`: no stepper, no remove, no CTAs. */
export const ReadOnly: StoryObj = {
  render: () => (
    <CartDrawer
      open
      onClose={noop}
      cart={cart}
      readOnly
      canCreateOrder={false}
      canRequestQuote={false}
    />
  ),
};

export const Trigger: StoryObj = {
  render: () => (
    <div className="flex items-center gap-4 rounded-md bg-nav p-4">
      <CartButton count={0} onClick={noop} />
      <CartButton count={3} onClick={noop} />
      <CartButton count={42} onClick={noop} />
    </div>
  ),
};
