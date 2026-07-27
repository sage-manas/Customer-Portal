"use client";

import type { Cart, CartLine } from "@cc/domain";
import { AlertTriangle, ShoppingCart, Trash2, X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Skeleton } from "../primitives/skeleton";

import { Money } from "./Money";
import { QtyStepper } from "./QtyStepper";

/**
 * Cart drawer (docs/05-UI-UX-DESIGN.md §7.2): "persistent drawer — line
 * edit, MOQ/stock warnings, split CTA — Request Quote vs Create Order".
 *
 * The split CTA is the point: per the PRD both paths are allowed from a
 * cart, so neither is a fallback. A line's issues come from the service
 * (which computed them from SAP reads) — this component renders them and
 * decides nothing (CLAUDE.md rule 3).
 */

export interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  cart: Cart | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onQuantityChange?: (lineId: string, quantity: number) => void | Promise<void>;
  onRemoveLine?: (lineId: string) => void | Promise<void>;
  onCreateOrder?: () => void;
  onRequestQuote?: () => void;
  /** False for a buyer without `order:create` — the CTA is hidden, not just disabled. */
  canCreateOrder?: boolean;
  canRequestQuote?: boolean;
  /** Cart edits need `cart:manage`; without it the drawer is read-only. */
  readOnly?: boolean;
  busyLineId?: string;
  /**
   * Shown in place of the CTAs when neither is available — either because
   * the session lacks the permission or because the owning module isn't
   * built yet. An empty footer would read as a broken cart.
   */
  ctaNote?: React.ReactNode;
}

export function CartDrawer({
  open,
  onClose,
  cart,
  loading = false,
  error,
  onRetry,
  onQuantityChange,
  onRemoveLine,
  onCreateOrder,
  onRequestQuote,
  canCreateOrder = true,
  canRequestQuote = true,
  readOnly = false,
  busyLineId,
  ctaNote,
}: CartDrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const lines = cart?.lines ?? [];
  // An unpriced cart (SAP unreachable) can't be ordered — the value would be
  // a guess — but it can still be sent to sales as a quote request.
  const orderBlocked = !cart || cart.hasBlockingIssues || !cart.priced || lines.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Cart"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lg focus:outline-none"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-text">
            <ShoppingCart aria-hidden className="size-4" strokeWidth={1.75} />
            Cart
            {lines.length > 0 ? (
              <span className="text-[12px] font-normal text-text-dim">
                ({lines.length} {lines.length === 1 ? "item" : "items"})
              </span>
            ) : null}
          </h2>
          <button
            type="button"
            aria-label="Close cart"
            onClick={onClose}
            className="rounded-md p-1 text-text-mid hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-20 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-md border border-danger-border bg-danger-subtle p-4 text-[12.5px] text-danger">
              <p>{error}</p>
              {onRetry ? (
                <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
                  Retry
                </Button>
              ) : null}
            </div>
          ) : lines.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[13px] font-semibold text-text">Your cart is empty</p>
              <p className="mx-auto mt-1 max-w-xs text-[12px] text-text-dim">
                Add items from the catalogue and they'll wait here — your colleagues on this account
                see the same cart.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  readOnly={readOnly}
                  busy={busyLineId === line.id}
                  onQuantityChange={onQuantityChange}
                  onRemove={onRemoveLine}
                />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 ? (
          <footer className="border-t border-border px-4 py-3">
            {!cart?.priced ? (
              <p
                role="status"
                className="mb-3 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-[11.5px] text-warning"
              >
                Prices are unavailable right now — your cart is saved, and you can still request a
                quote.
              </p>
            ) : null}

            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[12px] text-text-dim">Net value (ex-GST)</span>
              <Money value={cart?.netValue ?? 0} className="text-[15px] font-bold" />
            </div>

            {/* Split CTA — per the PRD both paths are allowed (docs/05 §7.2). */}
            {(canRequestQuote && onRequestQuote) || (canCreateOrder && onCreateOrder) ? (
              <div className="flex gap-2">
                {canRequestQuote && onRequestQuote ? (
                  <Button variant="secondary" className="flex-1" onClick={onRequestQuote}>
                    Request Quote
                  </Button>
                ) : null}
                {canCreateOrder && onCreateOrder ? (
                  <Button className="flex-1" disabled={orderBlocked} onClick={onCreateOrder}>
                    Create Order
                  </Button>
                ) : null}
              </div>
            ) : ctaNote ? (
              <p className="rounded-md border border-border bg-background px-3 py-2 text-[11.5px] text-text-dim">
                {ctaNote}
              </p>
            ) : null}

            {cart?.hasBlockingIssues ? (
              <p className="mt-2 text-[11px] text-danger">
                Fix the flagged lines before creating an order.
              </p>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function CartLineRow({
  line,
  readOnly,
  busy,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  readOnly: boolean;
  busy: boolean;
  onQuantityChange?: (lineId: string, quantity: number) => void | Promise<void>;
  onRemove?: (lineId: string) => void | Promise<void>;
}) {
  return (
    <li className="flex gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10.5px] text-text-dim">{line.material}</p>
        <p className="truncate text-[12.5px] font-medium text-text">{line.description}</p>

        <div className="mt-1.5 flex items-center gap-2">
          {readOnly ? (
            <span className="font-mono text-[12px] tabular-nums text-text-mid">
              {line.quantity} {line.uom}
            </span>
          ) : (
            <QtyStepper
              value={line.quantity}
              onChange={(quantity) => void onQuantityChange?.(line.id, quantity)}
              minimumOrderQty={line.minimumOrderQty}
              uom={line.uom}
              label={`Quantity of ${line.material}`}
              disabled={busy}
            />
          )}
          {line.netPrice !== null ? (
            <span className="text-[11px] text-text-dim">
              × <Money value={line.netPrice} showSymbol={false} className="text-[11px]" />
            </span>
          ) : null}
        </div>

        {line.issues.map((issue) => (
          <p
            key={issue.code}
            className={cn(
              "mt-1.5 flex items-start gap-1 text-[11px]",
              issue.severity === "blocker" ? "text-danger" : "text-warning",
            )}
          >
            <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
            {issue.message}
          </p>
        ))}
      </div>

      <div className="flex flex-col items-end justify-between">
        {line.lineValue !== null ? (
          <Money value={line.lineValue} className="text-[12.5px] font-semibold" />
        ) : (
          <span className="text-[11px] text-text-dim">—</span>
        )}
        {!readOnly && onRemove ? (
          <button
            type="button"
            aria-label={`Remove ${line.material} from cart`}
            disabled={busy}
            onClick={() => void onRemove(line.id)}
            className="rounded-md p-1 text-text-dim hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Top-bar trigger with the line-count badge. */
export function CartButton({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `Cart, ${count} items` : "Cart, empty"}
      className={cn(
        "relative rounded-md p-1.5 text-white/80 transition-colors duration-micro hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        className,
      )}
    >
      <ShoppingCart aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent-catalog text-[9.5px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );
}
