"use client";

import type { Material, StockAvailability } from "@cc/domain";
import { ProductCard } from "@cc/ui";
import * as React from "react";

import { useCart } from "@/components/CartProvider";

/**
 * The card grid (docs/05 §7.2).
 *
 * Each card mounts immediately from the material master and then fetches
 * its own price and stock — "Price and stock lazily loaded per card with
 * skeletons (they're per-customer SAP calls)". One request per card is the
 * point: a slow condition record delays its own card, not the grid.
 */

interface Availability {
  price: number | null;
  listPrice: number | null;
  availability: StockAvailability;
  quantity: number | null;
  reason?: string;
}

export function ProductGrid({
  materials,
  plant,
  canAddToCart,
  hasAccount,
}: {
  materials: Material[];
  plant?: string;
  canAddToCart: boolean;
  hasAccount: boolean;
}) {
  if (materials.length === 0) {
    return (
      <section className="rounded-md border border-border bg-surface p-10 text-center shadow-sm">
        <h2 className="text-[14px] font-bold text-text">Nothing matches those filters</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-text-dim">
          Try a different material group or plant, or clear the search to see the full catalogue.
        </p>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {materials.map((material) => (
        <LazyProductCard
          key={material.material}
          material={material}
          plant={plant}
          canAddToCart={canAddToCart}
          hasAccount={hasAccount}
        />
      ))}
    </section>
  );
}

function LazyProductCard({
  material,
  plant,
  canAddToCart,
  hasAccount,
}: {
  material: Material;
  plant?: string;
  canAddToCart: boolean;
  hasAccount: boolean;
}) {
  const { addLine } = useCart();
  const [data, setData] = React.useState<Availability | null>(null);
  const [loading, setLoading] = React.useState(hasAccount);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    // No sold-to account means no customer-specific price to fetch — the
    // card renders without one rather than firing a request that 409s.
    if (!hasAccount) return;

    let cancelled = false;
    const params = new URLSearchParams({ quantity: String(material.minimumOrderQty) });
    if (plant) params.set("plant", plant);

    setLoading(true);
    fetch(
      `/api/catalogue/materials/${encodeURIComponent(material.material)}/availability?${params}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as {
          availability: {
            price: { netPrice: number; listPrice: number } | null;
            availability: StockAvailability;
            quantity: number | null;
            priceUnavailableReason?: string;
          };
        };
      })
      .then((body) => {
        if (cancelled) return;
        setData({
          price: body.availability.price?.netPrice ?? null,
          listPrice: body.availability.price?.listPrice ?? null,
          availability: body.availability.availability,
          quantity: body.availability.quantity,
          reason: body.availability.priceUnavailableReason,
        });
      })
      .catch(() => {
        // A failed price/stock read leaves the card browsable and quotable,
        // with the chip saying stock is unavailable (docs/05 P7).
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [material.material, material.minimumOrderQty, plant, hasAccount]);

  const addToCart = async (quantity: number) => {
    setAdding(true);
    try {
      await addLine(material.material, quantity);
    } finally {
      setAdding(false);
    }
  };

  return (
    <ProductCard
      material={material.material}
      description={material.description}
      uom={material.uom}
      minimumOrderQty={material.minimumOrderQty}
      href={`/catalogue/${encodeURIComponent(material.material)}`}
      imageUrl={material.imageUrl}
      price={loading ? undefined : (data?.price ?? null)}
      listPrice={data?.listPrice}
      availability={data?.availability ?? "unknown"}
      stockQuantity={data?.quantity}
      pricingLoading={loading}
      priceUnavailableReason={data?.reason}
      adding={adding}
      onAddToCart={canAddToCart ? addToCart : undefined}
      onRequestQuote={undefined}
    />
  );
}
