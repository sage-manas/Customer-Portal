"use client";

import type { OnboardingApplication } from "@cc/domain";
import { Button, ComplianceBadge, StatusBadge, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import * as api from "../api-client";
import { readDraftHandle } from "../draft-storage";

/**
 * `/register/status` (docs/05 §7.1): Submitted → Under review →
 * Approved/Rejected, with the reasons when there are any.
 *
 * Client-side because the applicant has no session — the draft token on
 * this device is what identifies the application (ADR-009).
 */

const STEPS = [
  { status: "Submitted", label: "Submitted", body: "We have your application." },
  {
    status: "PendingApproval",
    label: "Under review",
    body: "Our sales and credit teams are reviewing it.",
  },
  { status: "Approved", label: "Decision", body: "You'll get an email either way." },
] as const;

export function StatusTimeline({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [application, setApplication] = React.useState<OnboardingApplication | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const handle = readDraftHandle(tenantSlug);
    if (!handle) {
      setLoading(false);
      return;
    }

    api
      .fetchApplication(handle.applicationId, handle.draftToken)
      .then(({ application: found }) => setApplication(found))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "We couldn't load your application."),
      )
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  if (loading) {
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading…
      </p>
    );
  }

  if (!application) {
    return (
      <Card>
        <h2 className="text-[15px] font-bold text-text">No application on this device</h2>
        <p className="mt-2 text-[12.5px] text-text-dim">
          {error ??
            "We keep your application on the device you started it on. Open this page on that device, or start a new registration."}
        </p>
        <Button className="mt-4" onClick={() => router.push("/register")}>
          Start a registration
        </Button>
      </Card>
    );
  }

  const reachedIndex = STEPS.findIndex((step) => step.status === application.status);
  const decided = application.status === "Approved" || application.status === "Rejected";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-text">
              {(application.data.legalEntityName as string) ?? "Your application"}
            </h2>
            <p className="text-[11.5px] text-text-dim">
              {application.submittedAt
                ? `Submitted ${formatDisplayDate(application.submittedAt)}`
                : "Not submitted yet"}
            </p>
          </div>
          <StatusBadge status={application.status} />
        </div>

        {application.data.gstin ? (
          <div className="mt-3">
            <ComplianceBadge
              kind="gstin"
              value={application.data.gstin as string}
              state={application.gstinVerification?.verified ? "verified" : "unverified"}
              caption={application.gstinVerification?.legalName}
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => {
            const done = decided ? true : reachedIndex >= index;
            const isDecision = index === STEPS.length - 1;

            return (
              <li key={step.status} className="flex gap-3">
                <span
                  aria-hidden
                  className={`mt-1 size-2.5 shrink-0 rounded-pill ${
                    done ? "bg-primary" : "bg-border-strong"
                  }`}
                />
                <div>
                  <p
                    className={`text-[12.5px] font-medium ${done ? "text-text" : "text-text-dim"}`}
                  >
                    {isDecision && decided
                      ? application.status === "Approved"
                        ? "Approved"
                        : "Rejected"
                      : step.label}
                  </p>
                  <p className="text-[11.5px] text-text-dim">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {application.status === "Approved" ? (
        <Card tone="success">
          <h3 className="text-[13px] font-bold text-success">Your account is ready</h3>
          <p className="mt-1 text-[12.5px] text-text-mid">
            We&apos;ve created your customer account
            {application.sapCustomerCode ? (
              <>
                {" "}
                (<span className="font-mono">{application.sapCustomerCode}</span>)
              </>
            ) : null}{" "}
            and emailed your sign-in details.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block text-[12.5px] font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </Card>
      ) : null}

      {application.status === "Rejected" ? (
        <Card tone="danger">
          <h3 className="text-[13px] font-bold text-danger">We couldn&apos;t approve this</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-text-mid">
            {(application.rejectionReasons ?? []).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-text-dim">
            You can apply again with your details pre-filled once the points above are addressed.
          </p>
        </Card>
      ) : null}

      {application.status === "Draft" && application.reviewNote ? (
        <Card tone="warning">
          <h3 className="text-[13px] font-bold text-warning">We need a bit more from you</h3>
          <p className="mt-1 text-[12.5px] text-text-mid">{application.reviewNote}</p>
          <Button className="mt-3" onClick={() => router.push("/register")}>
            Update my application
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function Card({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  const toneClass = {
    default: "border-border bg-surface",
    success: "border-success-border bg-success-subtle",
    danger: "border-danger-border bg-danger-subtle",
    warning: "border-warning-border bg-warning-subtle",
  }[tone];

  return <section className={`rounded-md border p-5 shadow-sm ${toneClass}`}>{children}</section>;
}
