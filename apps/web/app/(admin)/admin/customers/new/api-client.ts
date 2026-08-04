import type { GstinVerification, OnboardingApplication, OnboardingDocumentKind } from "@cc/domain";

import { WizardApiError, type FieldIssue } from "@/components/onboarding/OnboardingWizard";

/**
 * Typed client for the back-office registration endpoints (ADR-056).
 *
 * The shape mirrors `app/(auth)/register/api-client.ts` and the difference
 * is the whole point: there is no draft-token header here, because the
 * session cookie is the credential. Two clients rather than one with a
 * `token?` parameter, so neither plane's call can accidentally be made
 * without its own credential.
 */

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

const BASE = "/api/admin/customers/registrations";

export async function startRegistration(): Promise<{ application: OnboardingApplication }> {
  return parse(await fetch(BASE, { method: "POST" }));
}

export async function fetchRegistration(
  applicationId: string,
): Promise<{ application: OnboardingApplication }> {
  return parse(await fetch(`${BASE}/${applicationId}`));
}

export async function saveStep(
  applicationId: string,
  step: number,
  values: Record<string, unknown>,
): Promise<{ application: OnboardingApplication }> {
  return parse(
    await fetch(`${BASE}/${applicationId}/step/${step}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }),
  );
}

export async function verifyGstin(
  applicationId: string,
): Promise<{ verification: GstinVerification }> {
  return parse(await fetch(`${BASE}/${applicationId}/gstin-verify`, { method: "POST" }));
}

export async function uploadDocument(
  applicationId: string,
  kind: OnboardingDocumentKind,
  file: File,
): Promise<{ application: OnboardingApplication }> {
  const form = new FormData();
  form.set("file", file);
  return parse(
    await fetch(`${BASE}/${applicationId}/documents/${kind}`, { method: "POST", body: form }),
  );
}

export async function removeDocument(
  applicationId: string,
  kind: OnboardingDocumentKind,
): Promise<{ application: OnboardingApplication }> {
  return parse(await fetch(`${BASE}/${applicationId}/documents/${kind}`, { method: "DELETE" }));
}

export interface CompleteRegistrationResult {
  kunnr: string;
  credentials: { email: string; temporaryPassword: string | null };
  emailed: boolean;
}

export async function completeRegistration(
  applicationId: string,
  decision: { salesOrg: string; distributionChannel: string; creditApprovalStatus?: string },
): Promise<CompleteRegistrationResult> {
  return parse(
    await fetch(`${BASE}/${applicationId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    }),
  );
}
