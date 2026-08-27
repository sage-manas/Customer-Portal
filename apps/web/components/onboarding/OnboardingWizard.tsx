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
import * as React from "react";

import { FIELD_OPTIONS } from "@/app/(auth)/register/field-options";

/**
 * The 4-step onboarding wizard (docs/05 §7.1) — one implementation, two
 * planes (ADR-056).
 *
 * The applicant fills this at `/register` holding a draft token; a tenant
 * admin fills the same thing at `/admin/customers/new` holding a session.
 * Everything that differs between them is behind `OnboardingWizardClient`:
 * which endpoints are called and what the last button does. Everything that
 * is the same — which fields exist, which step they sit on, how a validation
 * issue lands under its input, autosave, the exit guard — is here, once.
 *
 * There is no field list in this file either. Fields come from
 * `ONBOARDING_STEPS` + `onboardingStepFields` in `@cc/domain`, and the server
 * validates with the schema derived from the same rows.
 */

const AUTOSAVE_MS = 30_000;

type Values = Record<string, string>;

/** The endpoints one plane's wizard talks to. */
export interface OnboardingWizardClient {
  saveStep(
    applicationId: string,
    step: number,
    values: Record<string, unknown>,
  ): Promise<{ application: OnboardingApplication }>;
  verifyGstin(applicationId: string): Promise<{ verification: GstinVerification }>;
  uploadDocument(
    applicationId: string,
    kind: OnboardingDocumentKind,
    file: File,
  ): Promise<{ application: OnboardingApplication }>;
  removeDocument(
    applicationId: string,
    kind: OnboardingDocumentKind,
  ): Promise<{ application: OnboardingApplication }>;
}

export interface FieldIssue {
  field: string;
  message: string;
}

/** Errors carrying per-field issues, so they land under the right input. */
export class WizardApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: FieldIssue[] = [],
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface OnboardingWizardProps {
  applicationId: string;
  application: OnboardingApplication;
  client: OnboardingWizardClient;
  /** Label of the last step's primary button. */
  submitLabel: string;
  /**
   * What that button does. Runs after the last step has been saved, so the
   * server is already holding everything typed. Throwing a `WizardApiError`
   * puts its issues under their fields.
   */
  onSubmit: () => Promise<void>;
  /** Copy under the uploads on step 4 — different per plane. */
  finalStepAside?: React.ReactNode;
  /** Extra inputs the last step needs; the back office assigns sales org here. */
  finalStepExtra?: React.ReactNode;
  /** Called whenever the server hands back a newer application. */
  onApplicationChange?: (application: OnboardingApplication) => void;
}

export function OnboardingWizard({
  applicationId,
  application,
  client,
  submitLabel,
  onSubmit,
  finalStepAside,
  finalStepExtra,
  onApplicationChange,
}: OnboardingWizardProps) {
  const [current, setCurrent] = React.useState(1);
  const [values, setValues] = React.useState<Values>(() => toValues(application));
  const [completed, setCompleted] = React.useState<number[]>([]);
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | undefined>();
  const [verifying, setVerifying] = React.useState(false);
  const [verification, setVerification] = React.useState<GstinVerification | undefined>(
    application.gstinVerification,
  );
  const [uploading, setUploading] = React.useState<OnboardingDocumentKind | null>(null);
  const [documents, setDocuments] = React.useState(application.documents);
  const [dirty, setDirty] = React.useState(false);

  const adopt = React.useCallback(
    (next: OnboardingApplication) => {
      setValues(toValues(next));
      setVerification(next.gstinVerification);
      setDocuments(next.documents);
      onApplicationChange?.(next);
    },
    [onApplicationChange],
  );

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
      const payload = valuesForStep(values, onboardingStepFields(step));

      if (!silent) setBusy(true);
      try {
        const { application: next } = await client.saveStep(applicationId, step, payload);
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
    [adopt, applicationId, client, values],
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
    if (current < ONBOARDING_STEP_COUNT) {
      const saved = await save(current);
      if (!saved) return;
      setCompleted((previous) => [...new Set([...previous, current])]);
      setCurrent(current + 1);
      return;
    }

    setBusy(true);
    try {
      await onSubmit();
      setDirty(false);
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyGstin() {
    setVerifying(true);
    setFormError(null);
    try {
      // Save first: the service verifies the *stored* GSTIN, and evidence
      // must belong to the number on screen.
      const saved = await save(2);
      if (!saved) return;
      const { verification: result } = await client.verifyGstin(applicationId);
      setVerification(result);
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setVerifying(false);
    }
  }

  async function onUpload(kind: OnboardingDocumentKind, file: File) {
    setUploading(kind);
    try {
      const { application: next } = await client.uploadDocument(applicationId, kind, file);
      adopt(next);
      setIssues({});
    } catch (error) {
      applyError(error, setIssues, setFormError);
    } finally {
      setUploading(null);
    }
  }

  async function onRemove(kind: OnboardingDocumentKind) {
    try {
      const { application: next } = await client.removeDocument(applicationId, kind);
      adopt(next);
    } catch (error) {
      applyError(error, setIssues, setFormError);
    }
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
      continueLabel={current === ONBOARDING_STEP_COUNT ? submitLabel : undefined}
      onBack={current > 1 ? () => setCurrent(current - 1) : undefined}
      onContinue={() => void onContinue()}
      onSaveDraft={current < ONBOARDING_STEP_COUNT ? () => void save(current) : undefined}
      onStepSelect={(step) => setCurrent(step)}
    >
      {current === ONBOARDING_STEP_COUNT ? (
        <>
          <DocumentsStep
            documents={documents}
            issues={issues}
            uploading={uploading}
            onUpload={onUpload}
            onRemove={onRemove}
          />
          {finalStepExtra}
          {finalStepAside}
        </>
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
  documents,
  issues,
  uploading,
  onUpload,
  onRemove,
}: {
  documents: OnboardingApplication["documents"];
  issues: Record<string, string>;
  uploading: OnboardingDocumentKind | null;
  onUpload: (kind: OnboardingDocumentKind, file: File) => Promise<void>;
  onRemove: (kind: OnboardingDocumentKind) => Promise<void>;
}) {
  const fields = onboardingStepFields(ONBOARDING_STEP_COUNT);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {fields.map((field: SapFieldDef) => {
        const kind = field.portalField as OnboardingDocumentKind;
        const uploaded = documents.find((document) => document.kind === kind);

        return (
          <FileUpload
            key={kind}
            label={field.label}
            required={field.required === "M"}
            state={uploading === kind ? "uploading" : uploaded ? "uploaded" : "empty"}
            file={
              uploaded ? { fileName: uploaded.fileName, sizeBytes: uploaded.sizeBytes } : undefined
            }
            error={issues[kind]}
            onSelect={(file) => void onUpload(kind, file)}
            onRemove={uploaded ? () => void onRemove(kind) : undefined}
          />
        );
      })}
    </div>
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
            We check the number against GSTN before the application goes for review.
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
              isn&apos;t the legal entity name, check the GSTIN.
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

export function wizardErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function applyError(
  error: unknown,
  setIssues: (issues: Record<string, string>) => void,
  setFormError: (message: string | null) => void,
): void {
  if (error instanceof WizardApiError && error.issues.length > 0) {
    setIssues(Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message])));
    // Issues belonging to a field the current step doesn't render would
    // otherwise be invisible, so the summary line always shows too.
    setFormError(error.message);
    return;
  }
  setIssues({});
  setFormError(wizardErrorMessage(error));
}
