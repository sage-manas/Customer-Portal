"use client";

import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  type GstinVerification,
  type OnboardingApplication,
  type OnboardingDocumentKind,
  type SapFieldDef,
  onboardingStepFields,
} from "@cc/domain";
import { Button, ComplianceBadge, FileUpload, FormSection, SapField, WizardShell } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import * as api from "./api-client";
import { ApiError } from "./api-client";
import { clearDraftHandle, readDraftHandle, writeDraftHandle } from "./draft-storage";
import { FIELD_OPTIONS } from "./field-options";

/**
 * The 4-step onboarding wizard (docs/05-UI-UX-DESIGN.md §7.1).
 *
 * Every field on every step comes from `ONBOARDING_STEPS` +
 * `onboardingStepFields` in `@cc/domain` — there is no field list in this
 * file, and no `z.object` either: the server validates with the same
 * registry-derived schema and returns issues keyed by `portalField`, which
 * is what puts an error under the right input here.
 */

const AUTOSAVE_MS = 30_000;

type Values = Record<string, string>;

export function RegisterWizard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const [application, setApplication] = React.useState<OnboardingApplication | null>(null);
  const [handle, setHandle] = React.useState<{ applicationId: string; draftToken: string } | null>(
    null,
  );
  const [values, setValues] = React.useState<Values>({});
  const [current, setCurrent] = React.useState(1);
  const [completed, setCompleted] = React.useState<number[]>([]);
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | undefined>();
  const [verifying, setVerifying] = React.useState(false);
  const [verification, setVerification] = React.useState<GstinVerification | undefined>();
  const [uploading, setUploading] = React.useState<OnboardingDocumentKind | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const adopt = React.useCallback((next: OnboardingApplication) => {
    setApplication(next);
    setValues(toValues(next));
    setVerification(next.gstinVerification);
  }, []);

  // Resume an application if this browser already has one, otherwise start
  // a fresh draft — a refresh mid-wizard must not lose what was typed.
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
          adopt(existing);
          if (existing.status !== "Draft") router.replace("/register/status");
          setLoading(false);
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
        adopt(started.application);
      } catch (error) {
        if (!cancelled) {
          // A stale handle (application deleted, wrong tenant) must not trap
          // the applicant on a dead page.
          clearDraftHandle();
          setFormError(errorMessage(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [adopt, router, tenantSlug]);

  // Exit guard (docs/05 §3.2) — only while there is unsaved input.
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const stepFields = React.useMemo(() => onboardingStepFields(current), [current]);

  const save = React.useCallback(
    async (step: number, { silent = false } = {}): Promise<boolean> => {
      if (!handle) return false;
      const payload = valuesForStep(values, onboardingStepFields(step));

      if (!silent) setBusy(true);
      try {
        const { application: next } = await api.saveStep(
          handle.applicationId,
          handle.draftToken,
          step,
          payload,
        );
        adopt(next);
        setIssues({});
        setFormError(null);
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
        return true;
      } catch (error) {
        if (silent) return false; // autosave never interrupts typing
        applyError(error, setIssues, setFormError);
        return false;
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [adopt, handle, values],
  );

  // Autosave (docs/05 §3.2: "autosave every 30s").
  React.useEffect(() => {
    if (!dirty || current === ONBOARDING_STEP_COUNT) return;
    const timer = setTimeout(() => void save(current, { silent: true }), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [current, dirty, save]);

  function setValue(field: string, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setIssues(({ [field]: _removed, ...rest }) => rest);
    setDirty(true);
  }

  async function onContinue() {
    if (!handle) return;

    if (current < ONBOARDING_STEP_COUNT) {
      const saved = await save(current);
      if (!saved) return;
      setCompleted((previous) => [...new Set([...previous, current])]);
      setCurrent(current + 1);
      return;
    }

    setBusy(true);
    try {
      await api.submitApplication(handle.applicationId, handle.draftToken);
      setDirty(false);
      router.push("/register/status");
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyGstin() {
    if (!handle) return;
    setVerifying(true);
    setFormError(null);
    try {
      // Save first: the service verifies the *stored* GSTIN, and evidence
      // must belong to the number the applicant can see on screen.
      const saved = await save(2);
      if (!saved) return;
      const { verification: result } = await api.verifyGstin(
        handle.applicationId,
        handle.draftToken,
      );
      setVerification(result);
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setVerifying(false);
    }
  }

  async function onUpload(kind: OnboardingDocumentKind, file: File) {
    if (!handle) return;
    setUploading(kind);
    try {
      const { application: next } = await api.uploadDocument(
        handle.applicationId,
        handle.draftToken,
        kind,
        file,
      );
      adopt(next);
      setIssues({});
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setUploading(null);
    }
  }

  async function onRemove(kind: OnboardingDocumentKind) {
    if (!handle) return;
    try {
      const { application: next } = await api.removeDocument(
        handle.applicationId,
        handle.draftToken,
        kind,
      );
      adopt(next);
    } catch (error) {
      applyError(error, setIssues, setFormError);
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading your application…
      </p>
    );
  }

  const stepDef = ONBOARDING_STEPS[current - 1]!;

  return (
    <WizardShell
      steps={ONBOARDING_STEPS.map((step) => ({
        key: step.key,
        title: step.title,
        description: step.description,
      }))}
      current={current}
      completed={completed}
      busy={busy}
      lastSavedAt={lastSavedAt}
      error={formError}
      continueLabel={current === ONBOARDING_STEP_COUNT ? "Submit application" : undefined}
      onBack={current > 1 ? () => setCurrent(current - 1) : undefined}
      onContinue={() => void onContinue()}
      onSaveDraft={current < ONBOARDING_STEP_COUNT ? () => void save(current) : undefined}
      onStepSelect={(step) => setCurrent(step)}
    >
      {current === ONBOARDING_STEP_COUNT ? (
        <DocumentsStep
          application={application}
          issues={issues}
          uploading={uploading}
          onUpload={onUpload}
          onRemove={onRemove}
        />
      ) : (
        stepDef.sections.map((section) => (
          <FormSection key={section.title} title={section.title}>
            {section.fields.map((name) => {
              const field = stepFields.find((f) => f.portalField === name)!;
              return (
                <SapField
                  key={name}
                  field={field}
                  name={name}
                  options={FIELD_OPTIONS[name]}
                  value={values[name] ?? ""}
                  error={issues[name]}
                  onChange={(event) => setValue(name, event.currentTarget.value)}
                />
              );
            })}
          </FormSection>
        ))
      )}

      {current === 2 ? (
        <GstinPanel
          verification={verification}
          verifying={verifying}
          disabled={busy || !values.gstin}
          onVerify={() => void onVerifyGstin()}
        />
      ) : null}
    </WizardShell>
  );
}

/** Step 4: the three uploads, driven by the registry's FILE fields. */
function DocumentsStep({
  application,
  issues,
  uploading,
  onUpload,
  onRemove,
}: {
  application: OnboardingApplication | null;
  issues: Record<string, string>;
  uploading: OnboardingDocumentKind | null;
  onUpload: (kind: OnboardingDocumentKind, file: File) => Promise<void>;
  onRemove: (kind: OnboardingDocumentKind) => Promise<void>;
}) {
  const fields = onboardingStepFields(ONBOARDING_STEP_COUNT);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {fields.map((field: SapFieldDef) => {
          const kind = field.portalField as OnboardingDocumentKind;
          const uploaded = application?.documents.find((document) => document.kind === kind);

          return (
            <FileUpload
              key={kind}
              label={field.label}
              required={field.required === "M"}
              hint={field.notes}
              state={uploading === kind ? "uploading" : uploaded ? "uploaded" : "empty"}
              file={
                uploaded
                  ? { fileName: uploaded.fileName, sizeBytes: uploaded.sizeBytes }
                  : undefined
              }
              error={issues[kind]}
              onSelect={(file) => void onUpload(kind, file)}
              onRemove={uploaded ? () => void onRemove(kind) : undefined}
            />
          );
        })}
      </div>

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
    </>
  );
}

/** Step 2's live GSTN verification (docs/05 §7.1). */
function GstinPanel({
  verification,
  verifying,
  disabled,
  onVerify,
}: {
  verification?: GstinVerification;
  verifying: boolean;
  disabled: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onVerify}
          loading={verifying}
          disabled={disabled}
        >
          {verifying ? "Verifying with GSTN…" : "Verify GSTIN"}
        </Button>
        {!verification && !verifying ? (
          <p className="text-[11.5px] text-text-dim">
            We check the number against GSTN before your application goes for review.
          </p>
        ) : null}
      </div>

      {verification ? (
        <div aria-live="polite">
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
            caption={verification.verified ? verification.legalName : verification.message}
          />
          {verification.verified && verification.legalName ? (
            <p className="mt-1.5 text-[11.5px] text-text-dim">
              GSTN has this registration as <strong>{verification.legalName}</strong>. If that
              isn&apos;t your legal entity name, check the GSTIN.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function toValues(application: OnboardingApplication): Values {
  return Object.fromEntries(
    Object.entries(application.data as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

/** Only this step's fields are sent — a save must not resubmit the world. */
function valuesForStep(values: Values, fields: SapFieldDef[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.portalField];
    if (value !== undefined && value !== "") payload[field.portalField] = value;
  }
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function applyError(
  error: unknown,
  setIssues: (issues: Record<string, string>) => void,
  setFormError: (message: string | null) => void,
): void {
  if (error instanceof ApiError && error.issues.length > 0) {
    setIssues(Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message])));
    // Issues that belong to a field the current step doesn't render would
    // otherwise be invisible, so the summary line always shows too.
    setFormError(error.message);
    return;
  }
  setIssues({});
  setFormError(errorMessage(error));
}
