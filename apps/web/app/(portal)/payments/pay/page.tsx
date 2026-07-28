import { hasPermission } from "@cc/domain";
import { listPayableItems } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, StaleDataBanner } from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MakePaymentForm } from "./MakePaymentForm";

import { getSession } from "@/lib/session";

/**
 * Make Payment (docs/03 Screen 7.2, docs/05 §7.7): "step 1 — open-invoice
 * multi-select table; step 2 — summary + mode; step 3 — gateway
 * redirect/modal".
 *
 * The open items are read on the server so the first paint is real data, and
 * the selection itself is client state. Whatever the customer picks is
 * re-validated against a fresh SAP read when they submit — a screen minutes
 * old must never be able to pay an invoice a colleague has already settled.
 */

export const dynamic = "force-dynamic";

export default async function MakePaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Presentation only — `/api/payments` re-checks `payment:pay` on the POST
  // that actually moves money (docs/05 §4.3).
  if (!hasPermission(session, "payment:pay")) redirect("/payments");
  if (!session.kunnr) redirect("/payments");

  const params = await searchParams;
  const preselect = Array.isArray(params.invoice) ? params.invoice[0] : params.invoice;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const payable = await listPayableItems(sap, session.kunnr);

  return (
    <>
      {payable.freshness === "stale" ? <StaleDataBanner syncedAt={payable.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/payments" className="hover:text-primary">
          Payments
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">Make a payment</span>
      </nav>

      <PageHeader
        title="Make a payment"
        subtitle="Choose the invoices you want to settle. You can pay part of one."
        meta={<SapSyncIndicator state={payable.freshness} syncedAt={payable.syncedAt} />}
      />

      <MakePaymentForm items={payable.items} currency={payable.currency} preselect={preselect} />
    </>
  );
}
