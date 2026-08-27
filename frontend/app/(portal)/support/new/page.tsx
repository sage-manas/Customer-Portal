import { hasPermission, isTicketCategory } from "@cc/domain";
import { PageHeader } from "@cc/ui";
import { redirect } from "next/navigation";

import { TicketForm } from "./TicketForm";

import { getSession } from "@/lib/session";

/**
 * Raise Ticket (docs/03 Screen 8.1, docs/05 §7.8).
 *
 * The query string can pre-fill the category and the document being disputed —
 * doc 05 §7.8: "pre-filled when arriving from POD/invoice dispute". It is only
 * a starting point: the reference is validated against SAP *and against this
 * customer's KUNNR* when the ticket is submitted, so a hand-edited URL buys
 * nothing.
 *
 * The permission check is here as well as on the API because a customer who
 * cannot raise tickets should meet the answer before typing a page of prose,
 * not after. The route handler is still what enforces it (docs/05 §4.3).
 */

export const dynamic = "force-dynamic";

const DOC_TYPES = ["order", "delivery", "invoice"] as const;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "support:create")) redirect("/403");

  const params = await searchParams;
  const category = one(params.category);
  const docType = one(params.docType);
  const docNumber = one(params.docNumber);

  return (
    <>
      <PageHeader
        title="Raise a ticket"
        subtitle="Tell us what's wrong and we'll pick it up. You'll get a ticket number to track it."
      />

      <div className="max-w-2xl rounded-md border border-border bg-surface p-5 shadow-sm">
        <TicketForm
          defaultCategory={category && isTicketCategory(category) ? category : undefined}
          defaultRelatedDocType={DOC_TYPES.find((type) => type === docType)}
          defaultRelatedDocNumber={docNumber}
        />
      </div>
    </>
  );
}
