import type { GstinVerification, OnboardingApplication, OnboardingDocumentKind } from "@cc/domain";

import { WizardApiError, type FieldIssue } from "@/components/onboarding/OnboardingWizard";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * Thin typed client for the public onboarding endpoints. One place that
 * knows the draft-token header exists, so no component builds a `fetch` by
 * hand and forgets it.
 */

/**
 * The wizard's error type, shared with the back-office client so both planes
 * put a field issue under the same input (`OnboardingWizard`).
 */
export { WizardApiError as ApiError };

const TOKEN_HEADER = "x-draft-token";

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (Partial<T> & { error?: string; issues?: FieldIssue[]; code?: string }) | null;

  if (!response.ok) {
    throw new WizardApiError(
      response.status,
      body?.error ?? "Something went wrong. Try again.",
      body?.issues ?? [],
      body?.code,
    );
  }
  return body as T;
}

export async function startApplication(): Promise<{
  application: OnboardingApplication;
  draftToken: string;
}> {
  return parse(await demoFetch("/api/onboarding", { method: "POST" }));
}

export async function fetchApplication(
  applicationId: string,
  draftToken: string,
): Promise<{ application: OnboardingApplication }> {
  return parse(
    await demoFetch(`/api/onboarding/${applicationId}`, { headers: { [TOKEN_HEADER]: draftToken } }),
  );
}

export async function saveStep(
  applicationId: string,
  draftToken: string,
  step: number,
  values: Record<string, unknown>,
): Promise<{ application: OnboardingApplication }> {
  return parse(
    await demoFetch(`/api/onboarding/${applicationId}/step/${step}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", [TOKEN_HEADER]: draftToken },
      body: JSON.stringify(values),
    }),
  );
}

export async function verifyGstin(
  applicationId: string,
  draftToken: string,
): Promise<{ verification: GstinVerification }> {
  return parse(
    await demoFetch(`/api/onboarding/${applicationId}/gstin-verify`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: draftToken },
    }),
  );
}

export async function uploadDocument(
  applicationId: string,
  draftToken: string,
  kind: OnboardingDocumentKind,
  file: File,
): Promise<{ application: OnboardingApplication }> {
  const form = new FormData();
  form.set("file", file);

  return parse(
    await demoFetch(`/api/onboarding/${applicationId}/documents/${kind}`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: draftToken },
      body: form,
    }),
  );
}

export async function removeDocument(
  applicationId: string,
  draftToken: string,
  kind: OnboardingDocumentKind,
): Promise<{ application: OnboardingApplication }> {
  return parse(
    await demoFetch(`/api/onboarding/${applicationId}/documents/${kind}`, {
      method: "DELETE",
      headers: { [TOKEN_HEADER]: draftToken },
    }),
  );
}

export async function submitApplication(
  applicationId: string,
  draftToken: string,
): Promise<{ application: OnboardingApplication }> {
  return parse(
    await demoFetch(`/api/onboarding/${applicationId}/submit`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: draftToken },
    }),
  );
}
