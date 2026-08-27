import { hasPermission } from "@cc/domain";
import { getPodFormDefaults, isDeliveryError } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, SapUnavailable, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PodForm } from "./PodForm";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Proof of Delivery (docs/03 Screen 5.2, docs/05 §7.5).
 *
 * Whether this screen may be opened at all is decided by the service, not by
 * whoever linked to it: a customer who bookmarks this URL for a shipment
 * still in the warehouse — or one already signed for — gets the same answer
 * as one who never saw a button. Permission is enforced here *and* on the
 * POST behind it; hiding the link is presentation, the route is the control
 * (docs/05 §4.3).
 */

export const dynamic = "force-dynamic";

export default async function PodPage({ params }: { params: Promise<{ vbeln: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;

  // Nobody is handed a form they cannot submit. Asked as a permission, not
  // as a role comparison (CLAUDE.md rule 5) — this used to name the role it
  // wanted to exclude, which meant the five-tier collapse would have silently
  // opened the form to everyone rather than failing to compile.
  if (!hasPermission(session, "delivery:confirm-receipt")) redirect(`/deliveries/${vbeln}`);

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() =>
    getPodFormDefaults(sap, session.kunnr, vbeln).catch((error: unknown) => {
      if (isDeliveryError(error) && error.code === "not_found") notFound();
      // Not despatched, or already signed for: the shipment screen explains
      // which, and it is the right place to land.
      if (isDeliveryError(error) && error.code === "not_allowed") redirect(`/deliveries/${vbeln}`);
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Confirm receipt" subtitle={`Delivery ${vbeln}.`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const defaults = result.data;
  const { delivery } = defaults;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/deliveries" className="hover:text-primary">
          Deliveries
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/deliveries/${delivery.vbeln}`} className="font-mono hover:text-primary">
          {delivery.vbeln}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">Proof of delivery</span>
      </nav>

      <PageHeader
        title="Confirm receipt"
        subtitle={
          delivery.actualGoodsIssue
            ? `Delivery ${delivery.vbeln}, dispatched ${formatDisplayDate(delivery.actualGoodsIssue)}${delivery.carrier ? ` via ${delivery.carrier}` : ""}.`
            : `Delivery ${delivery.vbeln}.`
        }
        meta={<SapSyncIndicator state={defaults.freshness} syncedAt={defaults.syncedAt} />}
      />

      <PodForm
        vbeln={delivery.vbeln}
        lines={delivery.lines.map((line) => ({
          lineNo: line.lineNo,
          material: line.material,
          description: line.description,
          uom: line.uom,
          dispatchedQty: line.quantity,
        }))}
        actualGoodsIssue={delivery.actualGoodsIssue}
      />
    </>
  );
}
