import { hasPermission } from "@cc/domain";
import { browseCatalogue } from "@cc/service-catalogue";
import { getDraft, isInquiryError, listDrafts } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapUnavailable } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RaiseInquiryForm, type InquiryFormSeed } from "./RaiseInquiryForm";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Raise Inquiry (docs/03 Screen 3.1, docs/05 §7.3).
 *
 * The form is seeded either empty or from a saved draft (`?draft=<id>`), and
 * the seeding happens here on the server — the browser is never handed a
 * draft it hasn't been checked against the session's sold-to account.
 *
 * With no `?draft`, the most recent draft on the account is offered as a link
 * rather than loaded silently: picking up somebody else's half-finished form
 * without saying so is how a colleague's requirement gets sent by accident.
 */

export const dynamic = "force-dynamic";

export default async function NewInquiryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.draft) ? params.draft[0] : params.draft;

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="New inquiry" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so we can&apos;t raise an inquiry for
          you. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const kunnr = session.kunnr;
  const sap = await getSapAdapterForTenant(session.tenantId);
  const listRead = await safeRead(() =>
    Promise.all([browseCatalogue(sap), listDrafts(session.tenantId, kunnr)]),
  );

  if (!listRead.ok) {
    return (
      <>
        <PageHeader title="New inquiry" />
        <SapUnavailable reason={listRead.reason} />
      </>
    );
  }

  const [catalogue, drafts] = listRead.data;

  const seedRead = requested
    ? await safeRead(() => seedFromDraft(session.tenantId, kunnr, requested))
    : null;

  if (seedRead && !seedRead.ok) {
    return (
      <>
        <PageHeader title="New inquiry" />
        <SapUnavailable reason={seedRead.reason} />
      </>
    );
  }

  const seed: InquiryFormSeed = seedRead ? seedRead.data : { header: {}, lines: [] };

  const resumable = requested ? [] : drafts;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/inquiries" className="hover:text-primary">
          Inquiries
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">New inquiry</span>
      </nav>

      <PageHeader
        title="New inquiry"
        subtitle={
          seed.draftId
            ? "Resuming a saved draft."
            : "Tell us what you need and we'll come back with a price."
        }
      />

      {resumable.length > 0 ? (
        <p className="rounded-md border border-border bg-surface px-4 py-2.5 text-[12.5px] text-text-mid">
          This account has{" "}
          {resumable.length === 1 ? "a saved draft" : `${resumable.length} saved drafts`}.{" "}
          <Link
            href={`/inquiries/new?draft=${resumable[0]!.id}`}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Pick up the most recent
          </Link>
        </p>
      ) : null}

      <RaiseInquiryForm
        seed={seed}
        materials={catalogue.page.items}
        today={new Date().toISOString().slice(0, 10)}
        canCreate={hasPermission(session, "inquiry:create")}
      />
    </>
  );
}

async function seedFromDraft(
  tenantId: string,
  kunnr: string,
  draftId: string,
): Promise<InquiryFormSeed> {
  // A draft belonging to another account (or another tenant) is a 404 — the
  // same answer as a draft id that never existed (CLAUDE.md rule 5).
  const draft = await getDraft(tenantId, kunnr, draftId).catch((error: unknown) => {
    if (isInquiryError(error) && error.code === "not_found") notFound();
    throw error;
  });

  return { header: draft.header, draftId: draft.id, lines: draft.lines };
}
