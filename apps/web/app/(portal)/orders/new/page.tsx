import { hasPermission } from "@cc/domain";
import { browseCatalogue, getCart } from "@cc/service-catalogue";
import { getDraft, getOrderFormDefaults, isOrderError } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, StaleDataBanner } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CreateOrderForm, type OrderFormSeed } from "./CreateOrderForm";

import { getSession } from "@/lib/session";

/**
 * Create Order (docs/03 Screen 4.1, docs/05 §7.4).
 *
 * The form can be seeded three ways — empty, from the cart (`?from=cart`),
 * or from a saved draft (`?draft=<id>`) — and the seeding happens here, on
 * the server, so the browser is never trusted with the line prices or the
 * ship-to list.
 *
 * The cart and the draft belong to two different services. Composing them
 * here rather than teaching either service about the other is the same rule
 * as ADR-011: the caller sequences, the services stay independent.
 */

export const dynamic = "force-dynamic";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) || undefined;
  };

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="New order" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so we can&apos;t place an order for
          you. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const [defaults, catalogue] = await Promise.all([
    getOrderFormDefaults(sap, session.kunnr),
    browseCatalogue(sap),
  ]);

  const draftId = single("draft");
  const seed: OrderFormSeed = draftId
    ? await seedFromDraft(session.tenantId, session.kunnr, draftId)
    : single("from") === "cart"
      ? await seedFromCart(session.tenantId, session.kunnr, sap)
      : { header: {}, lines: [] };

  return (
    <>
      {defaults.freshness === "stale" ? <StaleDataBanner syncedAt={defaults.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/orders" className="hover:text-primary">
          Orders
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">New order</span>
      </nav>

      <PageHeader
        title="New order"
        subtitle={
          seed.fromCart
            ? "From your cart. Submitting empties it."
            : seed.draftId
              ? "Resuming a saved draft."
              : "Prices and availability come from SAP when you check or submit."
        }
        meta={<SapSyncIndicator state={defaults.freshness} syncedAt={defaults.syncedAt} />}
      />

      {defaults.credit && defaults.credit.available <= 0 ? (
        <div
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          Your account has no available credit right now, so anything you place will be held for our
          credit team to review. You can still submit it.
        </div>
      ) : null}

      <CreateOrderForm
        seed={seed}
        shipTos={defaults.shipTos}
        materials={catalogue.page.items}
        defaultPaymentTerms={defaults.paymentTerms}
        canCreate={hasPermission(session, "order:create")}
      />
    </>
  );
}

/**
 * A cart line's price is an estimate on this form, never a submitted value:
 * the cart was repriced when it was read, SAP prices again at VA01, and the
 * second answer is the one on the invoice.
 */
async function seedFromCart(
  tenantId: string,
  kunnr: string,
  sap: Awaited<ReturnType<typeof getSapAdapterForTenant>>,
): Promise<OrderFormSeed> {
  const cart = await getCart(tenantId, kunnr, sap);

  return {
    header: {},
    fromCart: true,
    lines: cart.lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
      estimatedPrice: line.netPrice ?? undefined,
    })),
  };
}

async function seedFromDraft(
  tenantId: string,
  kunnr: string,
  draftId: string,
): Promise<OrderFormSeed> {
  // A draft belonging to another account (or another tenant) is a 404 — the
  // same answer as a draft id that never existed (CLAUDE.md rule 5).
  const draft = await getDraft(tenantId, kunnr, draftId).catch((error: unknown) => {
    if (isOrderError(error) && error.code === "not_found") notFound();
    throw error;
  });

  return {
    header: draft.header,
    draftId: draft.id,
    lines: draft.lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
      estimatedPrice: line.price,
    })),
  };
}
