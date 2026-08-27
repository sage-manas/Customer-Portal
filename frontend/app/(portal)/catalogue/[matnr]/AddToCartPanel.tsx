"use client";

import type { StockAvailability } from "@cc/domain";
import { Button, QtyStepper, StockChip } from "@cc/ui";
import { Download } from "lucide-react";
import * as React from "react";

import { useCart } from "@/components/CartProvider";

/**
 * Buy box on the product detail page (docs/05 §7.2: MOQ enforcement on the
 * stepper, "Request quote" for large quantities).
 *
 * The MOQ is enforced by the stepper *and* by the cart service *and* by SAP
 * at VA01 — this one is the courtesy, not the control (docs/05 §4.3).
 */

/** Above this multiple of the MOQ, quoting beats self-service ordering. */
const LARGE_ORDER_MOQ_MULTIPLE = 20;

export function AddToCartPanel({
  material,
  uom,
  minimumOrderQty,
  availability,
  totalQuantity,
  priced,
  canAddToCart,
  specSheetUrl,
}: {
  material: string;
  uom: string;
  minimumOrderQty: number;
  availability: StockAvailability;
  totalQuantity: number;
  priced: boolean;
  canAddToCart: boolean;
  specSheetUrl?: string;
}) {
  const { addLine } = useCart();
  const [quantity, setQuantity] = React.useState(Math.max(minimumOrderQty, 1));
  const [adding, setAdding] = React.useState(false);

  const large = quantity >= minimumOrderQty * LARGE_ORDER_MOQ_MULTIPLE;

  return (
    <aside className="flex h-fit flex-col gap-3 rounded-md border border-border bg-surface p-5 shadow-sm">
      <StockChip availability={availability} quantity={totalQuantity} uom={uom} />

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Quantity
        </label>
        <QtyStepper
          value={quantity}
          onChange={setQuantity}
          minimumOrderQty={minimumOrderQty}
          uom={uom}
          label={`Quantity of ${material}`}
          disabled={adding}
        />
        {minimumOrderQty > 1 ? (
          <p className="mt-1 text-[11px] text-text-dim">
            Minimum order quantity {minimumOrderQty} {uom}
          </p>
        ) : null}
      </div>

      {canAddToCart && priced ? (
        <Button
          loading={adding}
          onClick={async () => {
            setAdding(true);
            try {
              await addLine(material, quantity);
            } finally {
              setAdding(false);
            }
          }}
        >
          Add to Cart
        </Button>
      ) : null}

      {!priced ? (
        <p className="text-[11.5px] text-text-dim">
          This item is priced on request — sales will quote it for you.
        </p>
      ) : large ? (
        <p className="text-[11.5px] text-text-dim">
          That&apos;s a large quantity — a quote will usually get you a better price than the
          catalogue rate.
        </p>
      ) : null}

      {availability === "out_of_stock" ? (
        <p className="text-[11.5px] text-warning">
          Out of stock today. You can still order — SAP will confirm the line on lead time.
        </p>
      ) : null}

      {specSheetUrl ? (
        <a
          href={specSheetUrl}
          className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline"
        >
          <Download aria-hidden className="size-3.5" />
          Spec sheet
        </a>
      ) : null}
    </aside>
  );
}
