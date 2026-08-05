import { randomBytes, timingSafeEqual } from "node:crypto";

import { isGstnError, type GstnAdapter } from "@cc/adapter-gstn";
import { isSapError, type SapAdapter } from "@cc/adapter-sap";
import { isStorageError } from "@cc/adapter-storage";
import { Prisma, db, getTenantId, runWithTenant } from "@cc/db";
import type {
  GstinVerification,
  OnboardingApplication,
  OnboardingApplicationInput,
  OnboardingApplicationStatus,
  OnboardingDocumentKind,
} from "@cc/domain";
import {
  ONBOARDING_DOCUMENT_KINDS,
  canTransition,
  isGstinBlocking,
  onboardingApprovalSchema,
  onboardingCrossFieldIssues,
  onboardingStepSchema,
  onboardingWriteSchema,
  stateCodeFromGstin,
  stateName,
} from "@cc/domain";
import type { z } from "zod";

import { documentStorageKey, getOnboardingStorage } from "./adapters";
import { OnboardingError } from "./errors";
import { toApplication, toDbStatus, type ApplicationRow } from "./mapping";
import { toCanonicalCustomer } from "./to-canonical-customer";

/**
 * Customer onboarding (docs/03 Module 1, docs/05 §7.1) — the module that
 * proves the whole vertical: registry -> validation -> service -> adapter
 * -> UI.
 *
 * Two audiences, two access models:
 *  - the **applicant** has no portal user until their account is created at
 *    approval, so they hold an unguessable draft token instead of a session
 *    (docs/DECISIONS.md ADR-009). Every applicant-facing function takes a
 *    `DraftHandle` and matches it in constant time.
 *  - the **reviewer** has a session, and the route handler checks
 *    `onboarding:review`/`onboarding:approve` before calling in here.
 *
 * Both go through `runWithTenant`, so an application belonging to another
 * tenant is simply not found — a 404, never a 403 (CLAUDE.md rule 5).
 */

export interface DraftHandle {
  applicationId: string;
  draftToken: string;
}

/**
 * Who is driving an application, and how they proved they may.
 *
 * The wizard has two entry points — the applicant's own (`/register`) and the
 * tenant admin's (`/admin/customers/new`, ADR-056) — and the flow between
 * them is identical: same registry, same schemas, same SAP write. What
 * differs is only the credential, so that is the only thing parameterised.
 * Every shared implementation below takes this as a *required* argument, for
 * the reason ADR-032 gives for `getInquiries(kunnr)` vs `getInquiryQueue()`:
 * a check that can be skipped by omitting an argument is not a check.
 *
 * The two entry points then live in separate files (`onboarding-service.ts`
 * here, `back-office-service.ts` next door), so neither app plane can reach
 * the other's by dropping a parameter.
 */
export type ApplicationAccess =
  /** The applicant, holding the unguessable draft token (ADR-009). */
  | { kind: "draft"; draftToken: string }
  /** A tenant admin holding `customer:register`, checked by the route. */
  | { kind: "back_office" };

export interface StartApplicationResult {
  application: OnboardingApplication;
  /** Returned exactly once, to the applicant. Never included in a mapped application. */
  draftToken: string;
}

export interface OnboardingApplicationSummary {
  id: string;
  status: OnboardingApplicationStatus;
  legalEntityName: string;
  gstin?: string;
  contactEmail?: string;
  city?: string;
  state?: string;
  gstinVerified: boolean;
  documentCount: number;
  sapCustomerCode?: string;
  submittedAt?: Date;
  createdAt: Date;
}

export interface ApprovalDecision {
  salesOrg: string;
  distributionChannel: string;
  creditApprovalStatus?: string;
  actorUserId: string;
}

export interface ApprovalResult {
  application: OnboardingApplication;
  /** The KUNNR SAP assigned — the reviewer sees it, and it seeds portal access. */
  kunnr: string;
  contactEmail: string;
  legalEntityName: string;
}

const INCLUDE = {
  documents: { orderBy: { kind: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
} as const;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Fields stored upper-cased because SAP and the statutory registers are. */
const UPPERCASE_FIELDS = new Set(["pan", "gstin", "ifsc", "cin", "tan", "country", "state"]);

function normalizeValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (typeof value !== "string") return [key, value];
      const trimmed = value.trim();
      return [key, UPPERCASE_FIELDS.has(key) ? trimmed.toUpperCase() : trimmed];
    }),
  );
}

function issuesFromZod(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: String(issue.path[0] ?? ""),
    message: issue.message,
  }));
}

/**
 * Constant-time token comparison. A timing-distinguishable check on a
 * bearer token is a slow oracle for guessing it, and this token is the only
 * thing standing between a stranger and an applicant's PAN.
 */
function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function newDraftToken(): string {
  return randomBytes(32).toString("base64url");
}

async function loadRow(
  applicationId: string,
): Promise<ApplicationRow & { draftToken: string; initiatedByUserId: string | null }> {
  const row = await db.onboardingApplication.findFirst({
    where: { id: applicationId },
    include: INCLUDE,
  });
  // Cross-tenant lookups land here too: the tenant-scoped extension has
  // already narrowed the query, so another tenant's application "does not
  // exist" rather than being refused.
  if (!row) throw new OnboardingError("not_found");
  return row;
}

/**
 * Loads an application the caller has proved a right to, and 404s otherwise.
 *
 * The back-office arm is narrower than "holds the permission": it may only
 * reach applications the back office *started*. A tenant admin editing an
 * applicant's own in-flight draft would be changing statutory details on
 * somebody's behalf without their knowledge, and there is a queue screen and
 * a Request-More-Info path for that conversation. Both arms answer 404 on a
 * refusal, per CLAUDE.md rule 5.
 */
async function loadAccessible(applicationId: string, access: ApplicationAccess) {
  const row = await loadRow(applicationId);

  if (access.kind === "draft") {
    if (!tokenMatches(row.draftToken, access.draftToken)) throw new OnboardingError("not_found");
    return row;
  }

  if (row.initiatedByUserId === null) throw new OnboardingError("not_found");
  return row;
}

async function recordEvent(
  applicationId: string,
  status: OnboardingApplicationStatus,
  options: { note?: string; actorUserId?: string } = {},
): Promise<void> {
  await db.onboardingEvent.create({
    data: {
      tenantId: getTenantId(),
      applicationId,
      status: toDbStatus(status),
      note: options.note,
      actorUserId: options.actorUserId,
    },
  });
}

async function audit(
  action: string,
  applicationId: string,
  options: { actorUserId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: getTenantId(),
      actorUserId: options.actorUserId,
      action,
      entityType: "OnboardingApplication",
      entityId: applicationId,
      metadata: options.metadata ?? {},
    },
  });
}

function assertTransition(
  from: OnboardingApplicationStatus,
  to: OnboardingApplicationStatus,
): void {
  if (!canTransition(from, to)) throw new OnboardingError("invalid_transition");
}

// ---------------------------------------------------------------------------
// Applicant-facing
// ---------------------------------------------------------------------------

/**
 * Starts a blank application and mints its draft token.
 *
 * `initiatedByUserId` is what makes it a back-office registration: the token
 * is still minted (the column is not nullable and the row is still a draft),
 * but `startBackOfficeRegistration` never returns it, so the only credential
 * that reaches such a row is a session holding `customer:register`.
 *
 * @internal Shared by both entry points — call `startApplication` or
 * `startBackOfficeRegistration`, not this.
 */
export async function startApplicationCore(
  tenantId: string,
  options: { initiatedByUserId?: string } = {},
): Promise<StartApplicationResult> {
  return runWithTenant(tenantId, async () => {
    const draftToken = newDraftToken();
    const row = await db.onboardingApplication.create({
      data: {
        tenantId,
        data: {},
        draftToken,
        status: "draft",
        initiatedByUserId: options.initiatedByUserId,
      },
      include: INCLUDE,
    });
    await recordEvent(row.id, "Draft", { actorUserId: options.initiatedByUserId });
    await audit(
      options.initiatedByUserId ? "onboarding.started_by_back_office" : "onboarding.started",
      row.id,
      { actorUserId: options.initiatedByUserId },
    );

    return { application: toApplication({ ...row, events: [] }), draftToken };
  });
}

/** Starts an applicant's own application (the public `/register` wizard). */
export async function startApplication(tenantId: string): Promise<StartApplicationResult> {
  return startApplicationCore(tenantId);
}

/** @internal Shared by both entry points. */
export async function getApplicationCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () =>
    toApplication(await loadAccessible(applicationId, access)),
  );
}

export async function getDraftApplication(
  tenantId: string,
  handle: DraftHandle,
): Promise<OnboardingApplication> {
  return getApplicationCore(tenantId, handle.applicationId, {
    kind: "draft",
    draftToken: handle.draftToken,
  });
}

/**
 * Validates and persists one wizard step.
 *
 * Two passes, deliberately: the step schema (derived from the registry) for
 * the fields this step renders, then the cross-field rules against the
 * *merged* draft — GSTIN's state check needs step 1's address, which step 2
 * cannot see.
 */
export async function saveStepCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
  step: number,
  values: Record<string, unknown>,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccessible(applicationId, access);
    const status = toApplication(row).status;
    if (status !== "Draft") throw new OnboardingError("invalid_transition");

    const normalized = normalizeValues(values);
    const parsed = onboardingStepSchema(step).safeParse(normalized);
    if (!parsed.success) {
      throw new OnboardingError("invalid", { issues: issuesFromZod(parsed.error) });
    }

    const current = toApplication(row).data as Record<string, unknown>;
    const merged = { ...current, ...normalized };

    const crossFieldIssues = onboardingCrossFieldIssues(merged);
    if (crossFieldIssues.length > 0) {
      throw new OnboardingError("invalid", { issues: crossFieldIssues });
    }

    // Evidence belongs to a specific number: change the GSTIN and the
    // previous verification is no longer evidence of anything.
    const gstinChanged =
      typeof merged.gstin === "string" && merged.gstin !== (current.gstin as string | undefined);

    const updated = await db.onboardingApplication.update({
      where: { id: row.id },
      data: {
        data: merged as object,
        contactEmail: typeof merged.email === "string" ? merged.email : undefined,
        gstin: typeof merged.gstin === "string" ? merged.gstin : undefined,
        ...(gstinChanged ? { gstinVerification: Prisma.DbNull } : {}),
      },
      include: INCLUDE,
    });

    return toApplication(updated);
  });
}

export async function saveStep(
  tenantId: string,
  handle: DraftHandle,
  step: number,
  values: Record<string, unknown>,
): Promise<OnboardingApplication> {
  return saveStepCore(
    tenantId,
    handle.applicationId,
    { kind: "draft", draftToken: handle.draftToken },
    step,
    values,
  );
}

/**
 * Verifies the draft's GSTIN with GSTN and stores the answer as evidence
 * (ADR-010). Never throws for a *verification* result — an unverified GSTIN
 * is a state the wizard renders, not an error. It throws only when the
 * application itself can't be found or has no GSTIN yet.
 */
export async function verifyApplicationGstinCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
  gstn: GstnAdapter,
): Promise<GstinVerification> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccessible(applicationId, access);
    const application = toApplication(row);
    const gstin = application.data.gstin;
    if (typeof gstin !== "string" || gstin.length === 0) {
      throw new OnboardingError("invalid", {
        issues: [{ field: "gstin", message: "Enter a GSTIN before verifying it." }],
      });
    }

    const verification = await runVerification(gstn, gstin, application.data.state);

    await db.onboardingApplication.update({
      where: { id: row.id },
      data: { gstinVerification: verification as object },
    });
    await audit("onboarding.gstin_verified", row.id, {
      metadata: { gstin, outcome: verification.outcome },
    });

    return verification;
  });
}

export async function verifyApplicationGstin(
  tenantId: string,
  handle: DraftHandle,
  gstn: GstnAdapter,
): Promise<GstinVerification> {
  return verifyApplicationGstinCore(
    tenantId,
    handle.applicationId,
    { kind: "draft", draftToken: handle.draftToken },
    gstn,
  );
}

async function runVerification(
  gstn: GstnAdapter,
  gstin: string,
  billingState: string | undefined,
): Promise<GstinVerification> {
  const checkedAt = new Date().toISOString();

  try {
    const taxpayer = await gstn.verifyGstin(gstin);
    const base = {
      gstin,
      legalName: taxpayer.legalName,
      tradeName: taxpayer.tradeName,
      stateCode: taxpayer.stateCode,
      taxpayerStatus: taxpayer.status,
      registrationType: taxpayer.registrationType,
      checkedAt,
    };

    if (taxpayer.status !== "Active") {
      return {
        ...base,
        outcome: "inactive",
        verified: false,
        message: `GSTN reports this registration as ${taxpayer.status.toLowerCase()}. Use an active GSTIN, or contact us if you believe this is wrong.`,
      };
    }

    // docs/05 §7.1: a state mismatch blocks continuing, with an explanation.
    if (billingState && taxpayer.stateCode !== billingState) {
      return {
        ...base,
        outcome: "mismatch",
        verified: false,
        message: `GSTIN state (${taxpayer.stateCode} — ${stateName(taxpayer.stateCode) ?? "unknown"}) doesn't match your billing state (${billingState} — ${stateName(billingState) ?? "unknown"}). Update the billing address or check the GSTIN.`,
      };
    }

    return { ...base, outcome: "verified", verified: true };
  } catch (error) {
    if (!isGstnError(error)) throw error;

    const outcome =
      error.kind === "not_found"
        ? "not_found"
        : error.kind === "invalid_format"
          ? "invalid"
          : "unavailable";

    return {
      gstin,
      outcome,
      verified: false,
      stateCode: stateCodeFromGstin(gstin),
      // GstnError messages are already written for the applicant; the raw
      // upstream text stays on the error object for logs.
      message: error.message,
      checkedAt,
    };
  }
}

export interface UploadDocumentInput {
  kind: OnboardingDocumentKind;
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * Stores an uploaded document and links it to the application.
 *
 * @internal Shared by both entry points.
 */
export async function uploadDocumentCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
  input: UploadDocumentInput,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccessible(applicationId, access);
    if (toApplication(row).status !== "Draft") throw new OnboardingError("invalid_transition");
    if (!ONBOARDING_DOCUMENT_KINDS.includes(input.kind)) {
      throw new OnboardingError("invalid", {
        issues: [{ field: "kind", message: "That isn't a document we ask for." }],
      });
    }

    const key = documentStorageKey(tenantId, row.id, input.kind, input.fileName);

    let stored;
    try {
      stored = await getOnboardingStorage().put({
        key,
        body: input.body,
        contentType: input.contentType,
        fileName: input.fileName,
      });
    } catch (error) {
      if (isStorageError(error) && error.kind === "rejected") {
        throw new OnboardingError("invalid", {
          issues: [{ field: input.kind, message: error.message }],
          cause: error,
        });
      }
      throw new OnboardingError("upstream_unavailable", { cause: error });
    }

    await db.onboardingDocument.upsert({
      where: { tenantId_applicationId_kind: { tenantId, applicationId: row.id, kind: input.kind } },
      update: {
        storageKey: stored.key,
        fileName: stored.fileName,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        uploadedAt: new Date(),
      },
      create: {
        tenantId,
        applicationId: row.id,
        kind: input.kind,
        storageKey: stored.key,
        fileName: stored.fileName,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
      },
    });

    return toApplication(await loadRow(row.id));
  });
}

export async function uploadDocument(
  tenantId: string,
  handle: DraftHandle,
  input: UploadDocumentInput,
): Promise<OnboardingApplication> {
  return uploadDocumentCore(
    tenantId,
    handle.applicationId,
    { kind: "draft", draftToken: handle.draftToken },
    input,
  );
}

/** @internal Shared by both entry points. */
export async function removeDocumentCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
  kind: OnboardingDocumentKind,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccessible(applicationId, access);
    if (toApplication(row).status !== "Draft") throw new OnboardingError("invalid_transition");

    const document = row.documents?.find((d) => d.kind === kind);
    if (document) {
      await getOnboardingStorage().delete(document.storageKey);
      await db.onboardingDocument.deleteMany({ where: { applicationId: row.id, kind } });
    }

    return toApplication(await loadRow(row.id));
  });
}

export async function removeDocument(
  tenantId: string,
  handle: DraftHandle,
  kind: OnboardingDocumentKind,
): Promise<OnboardingApplication> {
  return removeDocumentCore(
    tenantId,
    handle.applicationId,
    { kind: "draft", draftToken: handle.draftToken },
    kind,
  );
}

/**
 * Reads a stored document. Callers must have proved their right to it
 * first — either the draft token (applicant) or `onboarding:review`
 * (reviewer); this function only enforces that the document belongs to an
 * application of *this* tenant.
 */
export async function readDocument(
  tenantId: string,
  applicationId: string,
  kind: OnboardingDocumentKind,
): Promise<{ fileName: string; contentType: string; body: Uint8Array }> {
  return runWithTenant(tenantId, async () => {
    const document = await db.onboardingDocument.findFirst({ where: { applicationId, kind } });
    if (!document) throw new OnboardingError("not_found");

    try {
      const object = await getOnboardingStorage().get(document.storageKey);
      return {
        fileName: document.fileName,
        contentType: document.contentType,
        body: object.body,
      };
    } catch (error) {
      throw new OnboardingError("not_found", { cause: error });
    }
  });
}

/**
 * Final submission. Runs the same system validation the flow in docs/03
 * describes — full-schema validation, GSTIN evidence, document presence,
 * duplicate guard — and moves the application straight on to
 * `PendingApproval`, which is what "Submitted → Under review" means on the
 * status timeline.
 *
 * @internal Shared by both entry points.
 */
export async function submitApplicationCore(
  tenantId: string,
  applicationId: string,
  access: ApplicationAccess,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccessible(applicationId, access);
    const application = toApplication(row);
    assertTransition(application.status, "Submitted");

    const documentKeys = Object.fromEntries(
      application.documents.map((document) => [document.kind, document.storageKey]),
    );
    const payload = { ...application.data, ...documentKeys };

    const parsed = onboardingWriteSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OnboardingError("incomplete", { issues: issuesFromZod(parsed.error) });
    }

    if (isGstinBlocking(application.gstinVerification)) {
      throw new OnboardingError("incomplete", {
        issues: [
          {
            field: "gstin",
            message:
              application.gstinVerification?.message ??
              "Your GSTIN couldn't be verified. Check the number and verify it again.",
          },
        ],
      });
    }
    if (!application.gstinVerification) {
      throw new OnboardingError("incomplete", {
        issues: [{ field: "gstin", message: "Verify your GSTIN before submitting." }],
      });
    }

    const gstin = parsed.data.gstin as string;
    const duplicate = await db.onboardingApplication.findFirst({
      where: {
        gstin,
        id: { not: row.id },
        status: { in: ["submitted", "pending_approval", "approved"] },
      },
    });
    if (duplicate) throw new OnboardingError("duplicate");

    const submittedAt = new Date();
    await db.onboardingApplication.update({
      where: { id: row.id },
      data: { status: "submitted", submittedAt, reviewNote: null, rejectionReasons: [] },
    });
    await recordEvent(row.id, "Submitted");

    // System validation passed, so it goes straight into the review queue —
    // two events, because the applicant's timeline shows both.
    await db.onboardingApplication.update({
      where: { id: row.id },
      data: { status: "pending_approval" },
    });
    await recordEvent(row.id, "PendingApproval");
    await audit("onboarding.submitted", row.id, { metadata: { gstin } });

    return toApplication(await loadRow(row.id));
  });
}

export async function submitApplication(
  tenantId: string,
  handle: DraftHandle,
): Promise<OnboardingApplication> {
  return submitApplicationCore(tenantId, handle.applicationId, {
    kind: "draft",
    draftToken: handle.draftToken,
  });
}

// ---------------------------------------------------------------------------
// Back-office
// ---------------------------------------------------------------------------

export interface ListApplicationsFilter {
  status?: OnboardingApplicationStatus;
  /** Matches legal entity name, GSTIN or contact email. */
  search?: string;
  limit?: number;
}

/** The onboarding approval queue (docs/05 §8). */
export async function listApplications(
  tenantId: string,
  filter: ListApplicationsFilter = {},
): Promise<OnboardingApplicationSummary[]> {
  return runWithTenant(tenantId, async () => {
    const search = filter.search?.trim();
    const rows = await db.onboardingApplication.findMany({
      where: {
        ...(filter.status ? { status: toDbStatus(filter.status) } : {}),
        ...(search
          ? {
              OR: [
                { gstin: { contains: search.toUpperCase() } },
                { contactEmail: { contains: search.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: filter.limit ?? 100,
    });

    return rows
      .map((row) => {
        const application = toApplication(row);
        return {
          id: application.id,
          status: application.status,
          legalEntityName: (application.data.legalEntityName as string) ?? "(unnamed draft)",
          gstin: application.data.gstin as string | undefined,
          contactEmail: application.data.email as string | undefined,
          city: application.data.city as string | undefined,
          state: application.data.state as string | undefined,
          gstinVerified: application.gstinVerification?.verified ?? false,
          documentCount: application.documents.length,
          sapCustomerCode: application.sapCustomerCode,
          submittedAt: application.submittedAt,
          createdAt: row.createdAt,
        };
      })
      .filter((summary) =>
        // Name search is applied here rather than in SQL: the legal name
        // lives inside the `data` JSON, and a JSON-path filter would tie
        // this query to Postgres-specific syntax for no real gain at
        // onboarding-queue scale.
        search ? matchesSearch(summary, search) : true,
      );
  });
}

function matchesSearch(summary: OnboardingApplicationSummary, search: string): boolean {
  const needle = search.toLowerCase();
  return [summary.legalEntityName, summary.gstin, summary.contactEmail].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}

export async function getApplicationForReview(
  tenantId: string,
  applicationId: string,
): Promise<OnboardingApplication> {
  return runWithTenant(tenantId, async () => toApplication(await loadRow(applicationId)));
}

/** "Request More Info": back to the applicant, with the reviewer's note. */
export async function requestMoreInfo(
  tenantId: string,
  applicationId: string,
  input: { note: string; actorUserId: string },
): Promise<OnboardingApplication> {
  const note = input.note.trim();
  if (note.length === 0) {
    throw new OnboardingError("invalid", {
      issues: [{ field: "note", message: "Tell the applicant what you need from them." }],
    });
  }

  return runWithTenant(tenantId, async () => {
    const row = await loadRow(applicationId);
    assertTransition(toApplication(row).status, "Draft");

    await db.onboardingApplication.update({
      where: { id: applicationId },
      data: { status: "draft", reviewNote: note, submittedAt: null },
    });
    await recordEvent(applicationId, "Draft", { note, actorUserId: input.actorUserId });
    await audit("onboarding.more_info_requested", applicationId, {
      actorUserId: input.actorUserId,
      metadata: { note },
    });

    return toApplication(await loadRow(applicationId));
  });
}

export async function rejectApplication(
  tenantId: string,
  applicationId: string,
  input: { reasons: string[]; actorUserId: string },
): Promise<OnboardingApplication> {
  const reasons = input.reasons.map((reason) => reason.trim()).filter(Boolean);
  if (reasons.length === 0) {
    // docs/05 §7.1: "Reject (reason mandatory)".
    throw new OnboardingError("invalid", {
      issues: [{ field: "reasons", message: "Give at least one reason for the rejection." }],
    });
  }

  return runWithTenant(tenantId, async () => {
    const row = await loadRow(applicationId);
    assertTransition(toApplication(row).status, "Rejected");

    await db.onboardingApplication.update({
      where: { id: applicationId },
      data: {
        status: "rejected",
        rejectionReasons: reasons,
        decidedAt: new Date(),
        decidedByUserId: input.actorUserId,
      },
    });
    await recordEvent(applicationId, "Rejected", {
      note: reasons.join("; "),
      actorUserId: input.actorUserId,
    });
    await audit("onboarding.rejected", applicationId, {
      actorUserId: input.actorUserId,
      metadata: { reasons },
    });

    return toApplication(await loadRow(applicationId));
  });
}

/**
 * "Approve & Create in SAP" — the write the whole module exists for.
 *
 * The SAP adapter is passed in rather than resolved here: it belongs to
 * `@cc/service-sap`, and a service may not import another service
 * (ADR-011). Portal credentials are issued by the identity service
 * afterwards, from the KUNNR this returns.
 */
export async function approveApplication(
  tenantId: string,
  applicationId: string,
  decision: ApprovalDecision,
  sap: SapAdapter,
): Promise<ApprovalResult> {
  const parsedDecision = onboardingApprovalSchema.safeParse({
    salesOrg: decision.salesOrg,
    distributionChannel: decision.distributionChannel,
    creditApprovalStatus: decision.creditApprovalStatus,
  });
  if (!parsedDecision.success) {
    throw new OnboardingError("invalid", { issues: issuesFromZod(parsedDecision.error) });
  }

  return runWithTenant(tenantId, async () => {
    const row = await loadRow(applicationId);
    const application = toApplication(row);
    assertTransition(application.status, "Approved");

    const documentKeys = Object.fromEntries(
      application.documents.map((document) => [document.kind, document.storageKey]),
    );
    const parsed = onboardingWriteSchema.safeParse({ ...application.data, ...documentKeys });
    if (!parsed.success) {
      throw new OnboardingError("incomplete", { issues: issuesFromZod(parsed.error) });
    }

    const customer = toCanonicalCustomer(parsed.data as OnboardingApplicationInput, {
      salesOrg: decision.salesOrg,
      distributionChannel: decision.distributionChannel,
    });

    let kunnr: string;
    try {
      const result = await sap.createCustomer(customer);
      kunnr = result.kunnr;
    } catch (error) {
      if (isSapError(error)) {
        // Raw SAP text never reaches the applicant; the reviewer sees it on
        // the admin screen, which is what `upstreamMessage` is for.
        if (error.kind === "unavailable") {
          throw new OnboardingError("upstream_unavailable", {
            upstreamMessage: error.sapMessage,
            cause: error,
          });
        }
        throw new OnboardingError("sap_rejected", {
          issues: error.field ? [{ field: error.field, message: error.message }] : [],
          upstreamMessage: error.sapMessage ?? error.message,
          cause: error,
        });
      }
      throw error;
    }

    await db.onboardingApplication.update({
      where: { id: applicationId },
      data: {
        status: "approved",
        sapCustomerCode: kunnr,
        salesOrg: decision.salesOrg,
        distributionChannel: decision.distributionChannel,
        creditApprovalStatus: decision.creditApprovalStatus,
        decidedAt: new Date(),
        decidedByUserId: decision.actorUserId,
      },
    });
    await recordEvent(applicationId, "Approved", {
      note: `Customer ${kunnr} created in SAP`,
      actorUserId: decision.actorUserId,
    });
    await audit("onboarding.approved", applicationId, {
      actorUserId: decision.actorUserId,
      metadata: {
        kunnr,
        salesOrg: decision.salesOrg,
        distributionChannel: decision.distributionChannel,
      },
    });

    return {
      application: toApplication(await loadRow(applicationId)),
      kunnr,
      contactEmail: parsed.data.email as string,
      legalEntityName: parsed.data.legalEntityName as string,
    };
  });
}
