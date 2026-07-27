import type { OnboardingStatus as DbOnboardingStatus } from "@cc/db";
import type {
  GstinVerification,
  OnboardingApplication,
  OnboardingApplicationInput,
  OnboardingApplicationStatus,
  OnboardingDocumentKind,
  OnboardingDocumentRef,
} from "@cc/domain";

/**
 * Translation between the Prisma enum (snake_case, a storage detail) and
 * the canonical status vocabulary (@cc/domain status.ts). Both directions
 * live here so the rest of the service — and every screen — only ever sees
 * the canonical value, per CLAUDE.md rule 3.
 */

const TO_DB: Record<OnboardingApplicationStatus, DbOnboardingStatus> = {
  Draft: "draft",
  Submitted: "submitted",
  PendingApproval: "pending_approval",
  Approved: "approved",
  Rejected: "rejected",
};

const FROM_DB: Record<DbOnboardingStatus, OnboardingApplicationStatus> = {
  draft: "Draft",
  submitted: "Submitted",
  pending_approval: "PendingApproval",
  approved: "Approved",
  rejected: "Rejected",
};

export const toDbStatus = (status: OnboardingApplicationStatus): DbOnboardingStatus =>
  TO_DB[status];

export const fromDbStatus = (status: DbOnboardingStatus): OnboardingApplicationStatus =>
  FROM_DB[status];

/** Row shapes we map from, kept structural so tests don't need Prisma. */
export interface ApplicationRow {
  id: string;
  tenantId: string;
  status: DbOnboardingStatus;
  data: unknown;
  gstinVerification: unknown;
  salesOrg: string | null;
  distributionChannel: string | null;
  creditApprovalStatus: string | null;
  sapCustomerCode: string | null;
  rejectionReasons: string[];
  reviewNote: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  documents?: DocumentRow[];
  events?: EventRow[];
}

export interface DocumentRow {
  kind: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface EventRow {
  status: DbOnboardingStatus;
  note: string | null;
  createdAt: Date;
}

function toData(value: unknown): Partial<OnboardingApplicationInput> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<OnboardingApplicationInput>)
    : {};
}

function toVerification(value: unknown): GstinVerification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<GstinVerification>;
  return typeof record.gstin === "string" && typeof record.checkedAt === "string"
    ? (record as GstinVerification)
    : undefined;
}

function toDocument(row: DocumentRow): OnboardingDocumentRef {
  return {
    kind: row.kind as OnboardingDocumentKind,
    storageKey: row.storageKey,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
  };
}

/**
 * Row -> domain entity. Note what is *not* here: the draft token never
 * leaves the service in a mapped application, so a response body can't leak
 * the applicant's bearer handle back out through a reviewer's screen.
 */
export function toApplication(row: ApplicationRow): OnboardingApplication {
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: fromDbStatus(row.status),
    data: toData(row.data),
    gstinVerification: toVerification(row.gstinVerification),
    documents: (row.documents ?? []).map(toDocument),
    events: (row.events ?? []).map((event) => ({
      at: event.createdAt,
      status: fromDbStatus(event.status),
      note: event.note ?? undefined,
    })),
    salesOrg: row.salesOrg ?? undefined,
    distributionChannel: row.distributionChannel ?? undefined,
    creditApprovalStatus: row.creditApprovalStatus ?? undefined,
    sapCustomerCode: row.sapCustomerCode ?? undefined,
    rejectionReasons: row.rejectionReasons.length > 0 ? row.rejectionReasons : undefined,
    reviewNote: row.reviewNote ?? undefined,
    submittedAt: row.submittedAt ?? undefined,
    decidedAt: row.decidedAt ?? undefined,
  };
}
