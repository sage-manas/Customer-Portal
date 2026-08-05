"use client";

import type { StockAvailability } from "@cc/domain";
import { Package } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Skeleton } from "../primitives/skeleton";

import { Money } from "./Money";
import { QtyStepper } from "./QtyStepper";
import { StockChip, StockChipSkeleton } from "./StockChip";

/**
 * Catalogue product card (docs/05-UI-UX-DESIGN.md §7.2): image, MATNR in
 * mono, MAKTX, **customer-specific price** labelled "your price", stock
 * chip, MEINS, qty stepper and Add to Cart.
 *
 * Price and stock arrive *after* the card: they are per-customer SAP calls
 * and doc 05 requires them to load lazily with skeletons. So `price` and
 * `availability` are optional, and `pricingLoading` renders the skeleton in
 * place — the card itself never waits on SAP.
 */

export interface ProductCardProps {
  /** MARA-MATNR */
  material: string;
  /** MAKT-MAKTX */
  description: string;
  /** MARA-MEINS */
  uom: string;
  /** MVKE-MINBM — seeds and steps the quantity control. */
  minimumOrderQty: number;
  href: string;
  imageUrl?: string;

  /** VK13 net price, ex-GST. Undefined while loading, null when unpriced. */
  price?: number | null;
  listPrice?: number | null;
  availability?: StockAvailability;
  stockQuantity?: number | null;
  pricingLoading?: boolean;
  /** Why there is no price — rendered instead of the amount. */
  priceUnavailableReason?: string;

  /** Omitted when the session lacks `cart:manage`: no CTA, per docs/05 §4.3.
   * The card is told, never asks — it holds no permission check of its own. */
  onAddToCart?: (quantity: number) => void | Promise<void>;
  onRequestQuote?: (quantity: number) => void;
  adding?: boolean;
  className?: string;
}

export function ProductCard({
  material,
  description,
  uom,
  minimumOrderQty,
  href,
  imageUrl,
  price,
  listPrice,
  availability,
  stockQuantity,
  pricingLoading = false,
  priceUnavailableReason,
  onAddToCart,
  onRequestQuote,
  adding = false,
  className,
}: ProductCardProps) {
  const [quantity, setQuantity] = React.useState(Math.max(minimumOrderQty, 1));
  const discounted =
    price !== null && price !== undefined && listPrice != null && listPrice > price;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm transition-colors duration-micro ease-portal hover:border-border-strong",
        className,
      )}
    >
      <a
        href={href}
        className="flex h-32 items-center justify-center bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {imageUrl ? (
          // Portal-managed asset (GOS-linked), not a SAP field. Plain <img>
          // rather than next/image: @cc/ui may not depend on Next (it is
          // consumed by Storybook too), and `apps -> ui` is one-directional.
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Package aria-hidden className="size-8 text-text-dim" strokeWidth={1.5} />
        )}
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div>
          <p className="font-mono text-[11px] tracking-tight text-text-dim">{material}</p>
          <a
            href={href}
            className="mt-0.5 block text-[13px] font-semibold leading-snug text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {description}
          </a>
        </div>

        <div className="flex min-h-[1.75rem] items-center justify-between gap-2">
          {pricingLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : price !== null && price !== undefined ? (
            <div className="flex items-baseline gap-1.5">
              <Money value={price} className="text-[14px] font-semibold" />
              {discounted ? (
                <Money
                  value={listPrice}
                  className="text-[11px] text-text-dim line-through"
                  showSymbol={false}
                />
              ) : null}
              <span className="text-[10.5px] uppercase tracking-wide text-text-dim">
                your price / {uom}
              </span>
            </div>
          ) : (
            <p className="text-[11.5px] text-text-dim">
              {priceUnavailableReason ?? "Price on request"}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {pricingLoading ? (
            <StockChipSkeleton />
          ) : (
            <StockChip
              availability={availability ?? "unknown"}
              quantity={stockQuantity}
              uom={uom}
            />
          )}
          {minimumOrderQty > 1 ? (
            <span className="text-[10.5px] text-text-dim">
              MOQ {minimumOrderQty} {uom}
            </span>
          ) : null}
        </div>

        {onAddToCart || onRequestQuote ? (
          <div className="mt-auto flex items-center gap-2 pt-1">
            <QtyStepper
              value={quantity}
              onChange={setQuantity}
              minimumOrderQty={minimumOrderQty}
              uom={uom}
              label={`Quantity of ${material}`}
              disabled={adding}
            />
            {onAddToCart && price !== null ? (
              <Button
                size="sm"
                className="flex-1"
                loading={adding}
                onClick={() => void onAddToCart(quantity)}
              >
                Add to Cart
              </Button>
            ) : onRequestQuote ? (
              // Doc 03 Screen 2.1 pairs every card with Request Quote — it is
              // the path for unpriced items, not a lesser alternative.
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => onRequestQuote(quantity)}
              >
                Request Quote
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-surface", className)}>
      <Skeleton className="h-32 w-full rounded-none" />
      <div className="space-y-2 p-3.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
