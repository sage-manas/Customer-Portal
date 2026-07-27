import { hasPermission, type OnboardingApplicationStatus } from "@cc/domain";
import { listApplications } from "@cc/service-onboarding";
import { PageHeader, StatusBadge, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/session";

/**
 * Onboarding approval queue (docs/05-UI-UX-DESIGN.md §8).
 *
 * Server-rendered and permission-checked here as well as in the API: this
 * page *is* a read of tenant data, so it enforces `onboarding:review`
 * itself rather than trusting the nav that got the user here.
 */

export const dynamic = "force-dynamic";

const FILTERS: { label: string; status?: OnboardingApplicationStatus }[] = [
  { label: "Awaiting review", status: "PendingApproval" },
  { label: "In progress", status: "Draft" },
  { label: "Approved", status: "Approved" },
  { label: "Rejected", status: "Rejected" },
  { label: "All" },
];

export default async function OnboardingQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // A permission the session doesn't hold is a 404, not a 403 — the queue's
  // existence is itself tenant information (CLAUDE.md rule 5).
  if (!hasPermission(session, "onboarding:review")) notFound();

  const params = await searchParams;
  const active = FILTERS.find((filter) => filter.label === params.status) ?? FILTERS[0]!;

  const applications = await listApplications(session.tenantId, {
    status: active.status,
    search: params.q,
  });

  return (
    <>
      <PageHeader
        title="Onboarding queue"
        subtitle="Applications from companies registering with you."
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <Link
            key={filter.label}
            href={`/admin/onboarding?status=${encodeURIComponent(filter.label)}`}
            aria-current={filter.label === active.label ? "page" : undefined}
            className={`rounded-pill border px-3 py-1 text-[11.5px] font-medium ${
              filter.label === active.label
                ? "border-primary bg-primary-subtle text-primary"
                : "border-border bg-surface text-text-mid hover:bg-primary-subtle"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        {applications.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-text-dim">
            Nothing here. New registrations land in “Awaiting review”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">Onboarding applications</caption>
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  {["Company", "GSTIN", "Location", "Documents", "Submitted", "Status"].map(
                    (header) => (
                      <th key={header} scope="col" className="px-4 py-2 font-bold">
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/onboarding/${application.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {application.legalEntityName}
                      </Link>
                      <span className="block text-[11px] text-text-dim">
                        {application.contactEmail}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11.5px] text-text-mid">
                        {application.gstin ?? "—"}
                      </span>
                      {application.gstin ? (
                        <span
                          className={`ml-1.5 text-[10.5px] ${
                            application.gstinVerified ? "text-success" : "text-text-dim"
                          }`}
                        >
                          {application.gstinVerified ? "✓ verified" : "not verified"}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {[application.city, application.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">{application.documentCount}/3</td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {application.submittedAt ? formatDisplayDate(application.submittedAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={application.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
