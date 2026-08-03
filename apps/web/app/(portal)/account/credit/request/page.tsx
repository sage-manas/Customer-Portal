import { hasPermission } from "@cc/domain";
import { getCreditPosition, listCreditRequests } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { CreditGauge, PageHeader } from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreditIncreaseForm } from "./CreditIncreaseForm";

import { getSession } from "@/lib/session";

/**
 * Request a credit limit increase (docs/03 Screen 9.1, docs/05 §7.9).
 *
 * The current position is rendered beside the form, because "how much should I
 * ask for?" is unanswerable without it — and because the same number is what
 * the service checks the ask against, so the customer sees the rule they are
 * being held to rather than discovering it in an error.
 *
 * The permission check is here as well as on the API because a customer who
 * cannot raise the request should meet the answer before writing their
 * justification, not after. The route handler is still what enforces it
 * (docs/05 §4.3).
 */

export const dynamic = "force-dynamic";

export default async function RequestCreditIncreasePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "credit:request")) redirect("/403");
  if (!session.kunnr) redirect("/account");

  const context = { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId };
  const sap = await getSapAdapterForTenant(session.tenantId);

  const [credit, requests] = await Promise.all([
    getCreditPosition(sap, context),
    listCreditRequests(context),
  ]);

  // One open ask per account, enforced in the service. Sending the customer
  // back rather than drawing a form that is going to be refused.
  if (requests.pending) redirect("/account");

  return (
    <>
      <PageHeader
        title="Request a credit limit increase"
        subtitle="Our credit team reviews this. Your limit changes when they apply it in our system, not when they approve here."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <CreditIncreaseForm currentLimit={credit.position.creditLimit} />
        </section>

        <aside className="space-y-3 rounded-md border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-[13px] font-bold text-text">Where you are now</h2>
          <CreditGauge position={credit.position} compact />
          <Link
            href="/account"
            className="inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Back to your account
          </Link>
        </aside>
      </div>
    </>
  );
}
