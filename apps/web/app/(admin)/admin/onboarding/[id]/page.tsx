import {
  ONBOARDING_STEPS,
  hasPermission,
  isValidPan,
  onboardingApplicantFields,
  panFromGstin,
  stateCodeFromGstin,
  stateName,
  type OnboardingApplication,
} from "@cc/domain";
import { getApplicationForReview, isOnboardingError } from "@cc/service-onboarding";
import { ComplianceBadge, DecisionGate, PageHeader, StatusBadge, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DecisionPanel } from "./DecisionPanel";

import { getSession } from "@/lib/session";

/**
 * Onboarding approval screen (docs/05-UI-UX-DESIGN.md §7.1): applicant
 * summary, document viewer, GSTN verification evidence, and the decision
 * actions — with the `DecisionGate` showing which system checks the
 * application actually passed, so the reviewer decides against evidence
 * rather than against a wall of fields.
 */

export const dynamic = "force-dynamic";

export default async function OnboardingReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "onboarding:review")) notFound();

  const { id } = await params;

  let application: OnboardingApplication;
  try {
    application = await getApplicationForReview(session.tenantId, id);
  } catch (error) {
    // Another tenant's application, or none at all — same answer either way.
    if (isOnboardingError(error) && error.code === "not_found") notFound();
    throw error;
  }

  const data = application.data as Record<string, string | undefined>;
  const verification = application.gstinVerification;
  const decidable = application.status === "PendingApproval";

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/admin/onboarding" className="hover:underline">
          Onboarding queue
        </Link>
        <span aria-hidden> / </span>
        <span>{data.legalEntityName ?? "Application"}</span>
      </nav>

      <PageHeader
        title={data.legalEntityName ?? "Application"}
        subtitle={[data.city, stateName(data.state)].filter(Boolean).join(", ")}
        meta={<StatusBadge status={application.status} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {ONBOARDING_STEPS.filter((step) => step.key !== "documents").map((step) => (
            <section
              key={step.key}
              className="overflow-hidden rounded-md border border-border bg-surface shadow-sm"
            >
              <h2 className="border-b border-border px-4 py-3 text-[15px] font-bold text-text">
                {step.title}
              </h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                {step.sections
                  .flatMap((section) => section.fields)
                  .map((name) => {
                    const field = onboardingApplicantFields().find((f) => f.portalField === name)!;
                    return (
                      <div key={name}>
                        <dt className="text-[10.5px] uppercase tracking-wide text-text-dim">
                          {field.label}
                          {/* SAP provenance is fine on an admin screen — the
                              customer never sees these (docs/05 §11). */}
                          <span className="ml-1 font-mono text-[9.5px] opacity-70">
                            {field.sapTable}-{field.sapField}
                          </span>
                        </dt>
                        <dd className="text-[12.5px] text-text">{formatValue(name, data[name])}</dd>
                      </div>
                    );
                  })}
              </dl>
            </section>
          ))}

          <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
            <h2 className="border-b border-border px-4 py-3 text-[15px] font-bold text-text">
              Documents
            </h2>
            <ul className="flex flex-col divide-y divide-border">
              {application.documents.length === 0 ? (
                <li className="px-4 py-4 text-[12.5px] text-text-dim">Nothing uploaded yet.</li>
              ) : (
                application.documents.map((document) => (
                  <li
                    key={document.kind}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="text-[12.5px] text-text-mid">
                      {labelFor(document.kind)} · {document.fileName}
                    </span>
                    <a
                      href={`/api/admin/onboarding/${application.id}/documents/${document.kind}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] font-medium text-primary hover:underline"
                    >
                      View
                    </a>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
            <h2 className="border-b border-border px-4 py-3 text-[15px] font-bold text-text">
              History
            </h2>
            <ol className="flex flex-col divide-y divide-border">
              {application.events.map((event, index) => (
                <li key={`${event.status}-${index}`} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={event.status} />
                    <span className="text-[11.5px] text-text-dim">
                      {formatDisplayDate(event.at)}
                    </span>
                  </div>
                  {event.note ? (
                    <p className="mt-1 text-[12px] text-text-mid">{event.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-[15px] font-bold text-text">GSTN evidence</h2>
            {verification ? (
              <>
                <ComplianceBadge
                  kind="gstin"
                  value={verification.gstin}
                  state={
                    verification.verified
                      ? "verified"
                      : verification.outcome === "unavailable"
                        ? "unverified"
                        : "failed"
                  }
                  caption={verification.legalName ?? verification.message}
                />
                <dl className="flex flex-col gap-1 text-[11.5px] text-text-mid">
                  <Row label="Legal name (GSTN)" value={verification.legalName} />
                  <Row label="Taxpayer status" value={verification.taxpayerStatus} />
                  <Row
                    label="State"
                    value={
                      verification.stateCode
                        ? `${verification.stateCode} — ${stateName(verification.stateCode) ?? "unknown"}`
                        : undefined
                    }
                  />
                  <Row label="Checked" value={formatDisplayDate(verification.checkedAt)} />
                </dl>
              </>
            ) : (
              <p className="text-[12.5px] text-text-dim">
                The applicant hasn&apos;t verified their GSTIN yet.
              </p>
            )}
          </section>

          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <DecisionGate title="System checks" items={gateItems(application)} />
          </section>

          <DecisionPanel
            applicationId={application.id}
            canApprove={hasPermission(session, "onboarding:approve")}
            decidable={decidable}
          />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-dim">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** The checks the service enforces, rendered so the reviewer can see them. */
function gateItems(application: OnboardingApplication) {
  const data = application.data as Record<string, string | undefined>;
  const verification = application.gstinVerification;
  const gstin = data.gstin;
  const pan = data.pan;

  const panMatches = Boolean(
    gstin && pan && isValidPan(pan) && panFromGstin(gstin) === pan.toUpperCase(),
  );
  const stateMatches = Boolean(gstin && data.state && stateCodeFromGstin(gstin) === data.state);
  const mandatoryDocs = ["panCardCopy", "gstCertificate"];
  const uploaded = application.documents.map((document) => document.kind);
  const docsPresent = mandatoryDocs.every((kind) => uploaded.includes(kind as never));

  return [
    {
      label: "GSTIN verified with GSTN",
      passed: verification?.verified ?? false,
      detail: verification?.verified
        ? `${verification.legalName ?? "Registered"} · ${verification.taxpayerStatus ?? "Active"}`
        : (verification?.message ?? "Not verified yet."),
    },
    {
      label: "PAN matches the GSTIN",
      passed: panMatches,
      detail: gstin ? `GSTIN carries PAN ${panFromGstin(gstin)}` : undefined,
    },
    {
      label: "GST state matches billing state",
      passed: stateMatches,
      detail: data.state ? `${data.state} — ${stateName(data.state) ?? "unknown"}` : undefined,
    },
    {
      label: "Mandatory documents uploaded",
      passed: docsPresent,
      detail: `${application.documents.length} of 3 uploaded`,
    },
  ];
}

function labelFor(kind: string): string {
  return onboardingApplicantFields().find((field) => field.portalField === kind)?.label ?? kind;
}

function formatValue(field: string, value: string | undefined): string {
  if (!value) return "—";
  if (field === "state") return `${value} — ${stateName(value) ?? "unknown"}`;
  return value;
}
