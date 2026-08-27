"use client";

import type { Cart } from "@cc/domain";
import { CartDrawer } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * Cart state for the whole portal shell (docs/05 §7.2 — the drawer is
 * persistent, so it lives above the page, not inside the catalogue route).
 *
 * The cart itself is server state: every mutation returns the whole,
 * repriced cart and that response replaces the local copy. Nothing here
 * recomputes a total or an issue — the service already did, from SAP reads,
 * and a second opinion in the browser is how the drawer and the order come
 * to disagree.
 */

interface CartContextValue {
  cart: Cart | null;
  lineCount: number;
  open: () => void;
  loading: boolean;
  error?: string;
  addLine: (material: string, quantity: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = React.useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartProvider>");
  return context;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "Something went wrong. Try again in a moment.";
}

export function CartProvider({
  children,
  initialLineCount,
  canManage,
  canCreateOrder,
  canRequestQuote,
}: {
  children: React.ReactNode;
  initialLineCount: number;
  canManage: boolean;
  canCreateOrder: boolean;
  canRequestQuote: boolean;
}) {
  const router = useRouter();
  const [cart, setCart] = React.useState<Cart | null>(null);
  const [lineCount, setLineCount] = React.useState(initialLineCount);
  const [isOpen, setIsOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [busyLineId, setBusyLineId] = React.useState<string>();

  const apply = React.useCallback((next: Cart) => {
    setCart(next);
    setLineCount(next.lines.length);
    setError(undefined);
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await demoFetch("/api/cart");
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      apply(((await response.json()) as { cart: Cart }).cart);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  const open = React.useCallback(() => {
    setIsOpen(true);
    void refresh();
  }, [refresh]);

  const mutate = React.useCallback(
    async (input: RequestInfo, init: RequestInit, lineId?: string) => {
      setBusyLineId(lineId);
      try {
        const response = await demoFetch(input, init);
        if (!response.ok) {
          setError(await readError(response));
          return;
        }
        apply(((await response.json()) as { cart: Cart }).cart);
      } finally {
        setBusyLineId(undefined);
      }
    },
    [apply],
  );

  const addLine = React.useCallback(
    async (material: string, quantity: number) => {
      await mutate("/api/cart/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material, quantity }),
      });
      setIsOpen(true);
    },
    [mutate],
  );

  const leaveTo = React.useCallback(
    (href: string) => {
      setIsOpen(false);
      router.push(href);
    },
    [router],
  );

  const value = React.useMemo<CartContextValue>(
    () => ({ cart, lineCount, open, loading, error, addLine, refresh }),
    [cart, lineCount, open, loading, error, addLine, refresh],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartDrawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        cart={cart}
        loading={loading && !cart}
        error={error}
        onRetry={() => void refresh()}
        readOnly={!canManage}
        busyLineId={busyLineId}
        canCreateOrder={canCreateOrder}
        canRequestQuote={canRequestQuote}
        onQuantityChange={(lineId, quantity) =>
          mutate(
            `/api/cart/lines/${lineId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quantity }),
            },
            lineId,
          )
        }
        onRemoveLine={(lineId) => mutate(`/api/cart/lines/${lineId}`, { method: "DELETE" }, lineId)}
        // Both CTAs are gated on the owning module being *built*, not just
        // permitted — the layout passes `false` while Inquiries (Phase 6) is
        // still `planned` in the nav registry, so the drawer never links
        // somewhere that 404s.
        //
        // `?from=cart` is what makes the order form seed itself from these
        // lines — and what tells the submit handler to empty the cart once
        // SAP has accepted the order.
        //
        // Both close the drawer on the way out. "Persistent" means it
        // outlives navigation, not that it stays *open* over the screen it
        // just sent the customer to — its overlay would cover the form.
        onCreateOrder={canCreateOrder ? () => leaveTo("/orders/new?from=cart") : undefined}
        onRequestQuote={canRequestQuote ? () => leaveTo("/inquiries/new") : undefined}
        ctaNote="Quotations arrive in a later phase. Your cart is saved — items and your prices will be waiting."
      />
    </CartContext.Provider>
  );
}
