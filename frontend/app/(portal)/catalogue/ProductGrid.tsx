"use client";

import type { Material, StockAvailability } from "@cc/domain";
import { ProductCard } from "@cc/ui";
import * as React from "react";

import { useCart } from "@/components/CartProvider";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * The card grid (docs/05 §7.2).
 *
 * Each card renders immediately from the material master; price and stock
 * arrive separately with their own skeleton per card. Those reads used to be
 * one `/availability` request per card (REMEDIATION-PLAN §6) — fine at a
 * fixed 24-card page, but it coupled to the page size that §4 made a real
 * variable, so a bigger page meant proportionally more requests.
 *
 * Now the grid fires **one** batched request for the whole page on mount and
 * hands each card its own slice of the result. Cards whose material is
 * missing from the response (a bad SAP read for just that item) fall back to
 * `null` pricing rather than blocking the rest of the page.
 */

interface Availability {
  price: number | null;
  listPrice: number | null;
  availability: StockAvailability;
  quantity: number | null;
  reason?: string;
}

const AvailabilityContext = React.createContext<{
  data: Record<string, Availability>;
  loading: boolean;
}>({ data: {}, loading: false });

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
  const [data, setData] = React.useState<Record<string, Availability>>({});
  const [loading, setLoading] = React.useState(hasAccount && materials.length > 0);

  React.useEffect(() => {
    // No sold-to account means no customer-specific price to fetch — the
    // grid renders without one rather than firing a request that 409s.
    // `loading`/`data` already default correctly for this case, so there is
    // nothing to reset here.
    if (!hasAccount || materials.length === 0) return;

    let cancelled = false;

    demoFetch("/api/catalogue/availability", {
      method: "POST",
      body: JSON.stringify({
        materials: materials.map((material) => ({
          material: material.material,
          quantity: material.minimumOrderQty,
        })),
        plant,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as {
          availability: Record<
            string,
            {
              price: { netPrice: number; listPrice: number } | null;
              availability: StockAvailability;
              quantity: number | null;
              priceUnavailableReason?: string;
            }
          >;
        };
      })
      .then((body) => {
        if (cancelled) return;
        const next: Record<string, Availability> = {};
        for (const [material, entry] of Object.entries(body.availability)) {
          next[material] = {
            price: entry.price?.netPrice ?? null,
            listPrice: entry.price?.listPrice ?? null,
            availability: entry.availability,
            quantity: entry.quantity,
            reason: entry.priceUnavailableReason,
          };
        }
        setData(next);
      })
      .catch(() => {
        // A failed batch read leaves every card browsable and quotable, with
        // the chip saying stock is unavailable (docs/05 P7).
        if (!cancelled) setData({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `page.tsx` keys this component on the filters/page that produced
    // `materials`, so this effect only ever runs once per mount — the array
    // reference is stable for the component's whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <AvailabilityContext.Provider value={{ data, loading }}>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {materials.map((material) => (
          <PricedProductCard
            key={material.material}
            material={material}
            canAddToCart={canAddToCart}
          />
        ))}
      </section>
    </AvailabilityContext.Provider>
  );
}

function PricedProductCard({
  material,
  canAddToCart,
}: {
  material: Material;
  canAddToCart: boolean;
}) {
  const { addLine } = useCart();
  const { data, loading } = React.useContext(AvailabilityContext);
  const [adding, setAdding] = React.useState(false);
  const entry = data[material.material];

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
      price={loading ? undefined : (entry?.price ?? null)}
      listPrice={entry?.listPrice}
      availability={entry?.availability ?? "unknown"}
      stockQuantity={entry?.quantity}
      pricingLoading={loading}
      priceUnavailableReason={entry?.reason}
      adding={adding}
      onAddToCart={canAddToCart ? addToCart : undefined}
      onRequestQuote={undefined}
    />
  );
}
