import type { Meta, StoryObj } from "@storybook/react";

import { ProductCard, ProductCardSkeleton } from "./ProductCard";

const meta: Meta<typeof ProductCard> = {
  title: "Domain/ProductCard",
  component: ProductCard,
};
export default meta;

type Story = StoryObj<typeof ProductCard>;

const base = {
  material: "MAT-10001",
  description: "Hydraulic Pump HP-200",
  uom: "EA",
  minimumOrderQty: 1,
  href: "/catalogue/MAT-10001",
  onAddToCart: () => {},
};

export const Default: Story = {
  args: {
    ...base,
    price: 42500,
    listPrice: 48575,
    availability: "in_stock",
    stockQuantity: 177,
  },
};

/** Price and stock are per-customer SAP calls, loaded after the card (docs/05 §7.2). */
export const PricingLoading: Story = {
  args: { ...base, pricingLoading: true },
};

export const LowStock: Story = {
  args: {
    ...base,
    material: "MAT-10002",
    description: "Hydraulic Pump HP-400 Heavy Duty",
    price: 78400,
    availability: "low",
    stockQuantity: 8,
  },
};

export const OutOfStock: Story = {
  args: {
    ...base,
    material: "MAT-10004",
    description: "Control Valve CV-80 SS316",
    minimumOrderQty: 5,
    price: 9800,
    availability: "out_of_stock",
    stockQuantity: 0,
  },
};

/** No PR00 condition record: browsable and quotable, not orderable online. */
export const Unpriced: Story = {
  args: {
    ...base,
    material: "MAT-90001",
    description: "Custom Skid Assembly (made to order)",
    price: null,
    priceUnavailableReason: "Price on request",
    availability: "unknown",
    onAddToCart: undefined,
    onRequestQuote: () => {},
  },
};

/** A `buyer_view_only` session gets no CTA at all (docs/05 §4.3). */
export const ReadOnly: Story = {
  args: {
    ...base,
    price: 42500,
    availability: "in_stock",
    stockQuantity: 177,
    onAddToCart: undefined,
  },
};

export const Adding: Story = {
  args: { ...base, price: 42500, availability: "in_stock", stockQuantity: 177, adding: true },
};

export const Loading: StoryObj = { render: () => <ProductCardSkeleton /> };

export const Grid: StoryObj = {
  render: () => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ProductCard {...base} price={42500} availability="in_stock" stockQuantity={177} />
      <ProductCard
        {...base}
        material="MAT-10003"
        description="Control Valve CV-50 Brass"
        minimumOrderQty={5}
        price={6250}
        availability="in_stock"
        stockQuantity={620}
      />
      <ProductCard
        {...base}
        material="MAT-20001"
        description="Seamless Steel Pipe 2in Sch40"
        uom="M"
        minimumOrderQty={50}
        price={890}
        availability="in_stock"
        stockQuantity={4800}
      />
      <ProductCardSkeleton />
    </div>
  ),
};
