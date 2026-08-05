"use client";

import type { OnboardingApplication } from "@cc/domain";
import { useRouter } from "next/navigation";
import * as React from "react";

import * as api from "./api-client";
import { clearDraftHandle, readDraftHandle, writeDraftHandle } from "./draft-storage";

import {
  OnboardingWizard,
  wizardErrorMessage,
  type OnboardingWizardClient,
} from "@/components/onboarding/OnboardingWizard";

/**
 * The applicant's entry to the onboarding wizard (docs/05 §7.1).
 *
 * Everything the wizard *does* lives in `OnboardingWizard`; this file owns
 * the two things that are the applicant's alone — the draft token they hold
 * instead of a session (ADR-009), stored in this browser so a refresh
 * mid-wizard doesn't lose what was typed, and the submission that puts the
 * application into the review queue.
 */
export function RegisterWizard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const [handle, setHandle] = React.useState<{ applicationId: string; draftToken: string } | null>(
    null,
  );
  const [application, setApplication] = React.useState<OnboardingApplication | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Resume an application if this browser already has one, otherwise start
  // a fresh draft.
  React.useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const stored = readDraftHandle(tenantSlug);
      try {
        if (stored) {
          const { application: existing } = await api.fetchApplication(
            stored.applicationId,
            stored.draftToken,
          );
          if (cancelled) return;
          setHandle(stored);
          setApplication(existing);
          if (existing.status !== "Draft") router.replace("/register/status");
          return;
        }

        const started = await api.startApplication();
        if (cancelled) return;
        const next = {
          applicationId: started.application.id,
          draftToken: started.draftToken,
          tenantSlug,
        };
        writeDraftHandle(next);
        setHandle(next);
        setApplication(started.application);
      } catch (bootError) {
        if (!cancelled) {
          // A stale handle (application deleted, wrong tenant) must not trap
          // the applicant on a dead page.
          clearDraftHandle();
          setError(wizardErrorMessage(bootError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router, tenantSlug]);

  const client = React.useMemo<OnboardingWizardClient | null>(() => {
    if (!handle) return null;
    const token = handle.draftToken;
    return {
      saveStep: (id, step, values) => api.saveStep(id, token, step, values),
      verifyGstin: (id) => api.verifyGstin(id, token),
      uploadDocument: (id, kind, file) => api.uploadDocument(id, token, kind, file),
      removeDocument: (id, kind) => api.removeDocument(id, token, kind),
    };
  }, [handle]);

  if (loading) {
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading your application…
      </p>
    );
  }

  if (!handle || !application || !client) {
    return (
      <p role="alert" className="text-[12.5px] text-danger">
        {error ?? "We couldn't start your application. Refresh and try again."}
      </p>
    );
  }

  return (
    <OnboardingWizard
      applicationId={handle.applicationId}
      application={application}
      client={client}
      submitLabel="Submit application"
      onSubmit={async () => {
        await api.submitApplication(handle.applicationId, handle.draftToken);
        router.push("/register/status");
      }}
      finalStepAside={
        <section className="mt-6 rounded-md border border-border bg-background px-4 py-3">
          <h3 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            What happens next
          </h3>
          <ol className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-text-mid">
            <li>1. We check your details and verify your GSTIN with GSTN.</li>
            <li>2. Our sales and credit teams review your application in parallel.</li>
            <li>
              3. On approval we create your customer account and email your sign-in details. If
              anything is missing, we&apos;ll come back to you with what we need.
            </li>
          </ol>
        </section>
      }
    />
  );
}
