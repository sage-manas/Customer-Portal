"use client";

import {
  ONBOARDING_INTERNAL_FIELDS,
  onboardingMapping,
  type OnboardingApplication,
} from "@cc/domain";
import { FormSection, SapField } from "@cc/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import * as api from "./api-client";

import {
  OnboardingWizard,
  wizardErrorMessage,
  type OnboardingWizardClient,
} from "@/components/onboarding/OnboardingWizard";

/**
 * "Register Customer" (doc 09 §3.4, ADR-056) — the tenant admin filling the
 * onboarding wizard on a customer's behalf.
 *
 * The wizard itself is the same component `/register` renders; this file
 * supplies the session-authenticated client and the one thing the applicant
 * flow has no equivalent of — the internal assignment fields, which the
 * reviewer normally provides at approval. That is the whole shape of "skips
 * the review gate": the approval decision is made here, on the last step, by
 * the person who filled the form.
 */

type Decision = { salesOrg: string; distributionChannel: string; creditApprovalStatus: string };

const INTERNAL_FIELDS = onboardingMapping.filter((field) =>
  (ONBOARDING_INTERNAL_FIELDS as readonly string[]).includes(field.portalField),
);

export function RegisterCustomerWizard() {
  const router = useRouter();

  const [applicationId, setApplicationId] = React.useState<string | null>(null);
  const [application, setApplication] = React.useState<OnboardingApplication | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<Decision>({
    salesOrg: "",
    distributionChannel: "",
    creditApprovalStatus: "",
  });
  const [result, setResult] = React.useState<api.CompleteRegistrationResult | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const started = await api.startRegistration();
        if (cancelled) return;
        setApplicationId(started.application.id);
        setApplication(started.application);
      } catch (bootError) {
        if (!cancelled) setError(wizardErrorMessage(bootError));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const client = React.useMemo<OnboardingWizardClient>(
    () => ({
      saveStep: api.saveStep,
      verifyGstin: api.verifyGstin,
      uploadDocument: api.uploadDocument,
      removeDocument: api.removeDocument,
    }),
    [],
  );

  if (result) {
    return <RegistrationDone result={result} onDone={() => router.push("/admin/customers")} />;
  }

  if (error) {
    return (
      <p role="alert" className="text-[12.5px] text-danger">
        {error}
      </p>
    );
  }

  if (!applicationId || !application) {
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Preparing the form…
      </p>
    );
  }

  return (
    <OnboardingWizard
      applicationId={applicationId}
      application={application}
      client={client}
      submitLabel="Create customer in SAP"
      onSubmit={async () => {
        setResult(
          await api.completeRegistration(applicationId, {
            salesOrg: decision.salesOrg,
            distributionChannel: decision.distributionChannel,
            creditApprovalStatus: decision.creditApprovalStatus || undefined,
          }),
        );
      }}
      finalStepExtra={
        <div className="mt-6">
          <FormSection title="Assignment (internal)">
            {INTERNAL_FIELDS.map((field) => (
              <SapField
                key={field.portalField}
                field={field}
                name={field.portalField}
                value={decision[field.portalField as keyof Decision] ?? ""}
                onChange={(event) => {
                  // Read before the updater runs, not inside it: React may
                  // call a functional updater after the handler has returned,
                  // by which time `currentTarget` is null and the whole screen
                  // dies on a keystroke.
                  const { value } = event.currentTarget;
                  setDecision((previous) => ({ ...previous, [field.portalField]: value }));
                }}
              />
            ))}
          </FormSection>
        </div>
      }
      finalStepAside={
        <section className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3">
          <h3 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            What this button does
          </h3>
          <ol className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-text-mid">
            <li>1. Validates everything above, exactly as a customer&apos;s own application is.</li>
            <li>
              2. Creates the customer master in SAP. There is no review queue — you are the
              approver, and the application records that.
            </li>
            <li>3. Issues portal credentials and emails them to the contact address.</li>
          </ol>
        </section>
      }
      onApplicationChange={setApplication}
    />
  );
}

function RegistrationDone({
  result,
  onDone,
}: {
  result: api.CompleteRegistrationResult;
  onDone: () => void;
}) {
  return (
    <section className="rounded-md border border-success-border bg-success-subtle px-4 py-4">
      <h2 className="text-[13px] font-bold text-text">Customer created</h2>
      <p className="mt-1 text-[12.5px] text-text-mid">
        SAP assigned customer number <span className="font-mono">{result.kunnr}</span>.
      </p>

      <dl className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
        <div className="flex gap-2">
          <dt className="text-text-dim">Sign-in email</dt>
          <dd className="font-mono text-text">{result.credentials.email}</dd>
        </div>
        {result.credentials.temporaryPassword ? (
          <div className="flex gap-2">
            <dt className="text-text-dim">Temporary password</dt>
            <dd className="font-mono text-text">{result.credentials.temporaryPassword}</dd>
          </div>
        ) : (
          <p className="text-text-mid">
            That address already had a portal login, so it keeps its existing password and has been
            linked to the new account.
          </p>
        )}
      </dl>

      <p className="mt-3 text-[11.5px] text-text-dim">
        {result.emailed
          ? "These details have been emailed to the customer. They'll be asked to set their own password at first sign-in."
          : "We couldn't send the email just now — pass these details on yourself. They are shown only once and are not stored anywhere in plain text."}
      </p>

      <div className="mt-4 flex gap-3 text-[12.5px]">
        <button type="button" onClick={onDone} className="text-primary hover:underline">
          Back to customers
        </button>
        <Link href="/admin/customers/new" className="text-primary hover:underline">
          Register another
        </Link>
      </div>
    </section>
  );
}
