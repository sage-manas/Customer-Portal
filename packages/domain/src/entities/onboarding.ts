import { z } from "zod";

import { onboardingMapping } from "../sap-mapping/onboarding";
import { buildZodSchema } from "../sap-mapping/to-zod";
import type { SapFieldDef } from "../sap-mapping/types";
import type { OnboardingApplicationStatus } from "../status";
import {
  GST_STATE_CODES,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  isValidPhone,
  isValidPinCode,
  panFromGstin,
  stateCodeFromGstin,
  stateName,
} from "../validation/india";

/**
 * Module 1 — Customer Onboarding.
 *
 * The wizard's shape is a registry too: which fields belong to which of the
 * four steps, and which section they sit in, is declared once here
 * (docs/05-UI-UX-DESIGN.md §7.1) and both the UI and the API read it. A
 * screen never carries its own field list, and no step schema is
 * hand-written — every one is derived from `onboardingMapping`.
 */

export interface OnboardingSectionDef {
  /** Section label, rendered as the form's section header (docs/05 §2.1). */
  title: string;
  /** `portalField` names, in display order. */
  fields: readonly string[];
}

export interface OnboardingStepDef {
  /** 1-based step number, as shown in the wizard's `n/4` indicator. */
  step: number;
  key: string;
  title: string;
  description: string;
  sections: readonly OnboardingSectionDef[];
}

export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    step: 1,
    key: "company",
    title: "Company Information",
    description: "Your legal entity and where we should bill you.",
    sections: [
      { title: "Company Identity", fields: ["legalEntityName", "tradeName", "customerType"] },
      { title: "Billing Address", fields: ["street", "city", "state", "pinCode", "country"] },
      { title: "Primary Contact", fields: ["contactPerson", "email", "phone"] },
    ],
  },
  {
    step: 2,
    key: "tax",
    title: "Tax & Regulatory",
    description: "We verify your GSTIN with GSTN before your application is reviewed.",
    sections: [
      { title: "Statutory Identifiers", fields: ["pan", "gstin", "gstRegistrationType"] },
      { title: "Additional Registrations", fields: ["cin", "tan", "msmeUdyamNo"] },
    ],
  },
  {
    step: 3,
    key: "credit",
    title: "Credit & Commercial",
    description: "What you'd like; the final terms are set by our credit team.",
    sections: [
      {
        title: "Commercial Terms",
        fields: ["requestedCreditLimit", "paymentTermsRequested", "preferredSalesOffice"],
      },
      {
        title: "Bank Details (for refunds only)",
        fields: ["accountHolderName", "bankAccountNo", "ifsc"],
      },
    ],
  },
  {
    step: 4,
    key: "documents",
    title: "Documents",
    description: "Upload the certificates that back up what you've entered.",
    sections: [
      {
        title: "Supporting Documents",
        fields: ["panCardCopy", "gstCertificate", "incorporationCert"],
      },
    ],
  },
] as const;

/** Fields the *tenant* fills at approval time, never the applicant (docs/03 Screen 1.4). */
export const ONBOARDING_INTERNAL_FIELDS = [
  "salesOrg",
  "distributionChannel",
  "creditApprovalStatus",
] as const;

/** Uploads, in the order step 4 renders them. */
export const ONBOARDING_DOCUMENT_KINDS = [
  "panCardCopy",
  "gstCertificate",
  "incorporationCert",
] as const;
export type OnboardingDocumentKind = (typeof ONBOARDING_DOCUMENT_KINDS)[number];

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

function fieldDef(portalField: string): SapFieldDef {
  const def = onboardingMapping.find((f) => f.portalField === portalField);
  // A step referencing a field the registry doesn't define is a bug in the
  // registry pair, not a runtime condition — fail at import, loudly.
  if (!def) throw new Error(`ONBOARDING_STEPS references unknown field "${portalField}"`);
  return def;
}

export function onboardingStepDef(step: number): OnboardingStepDef {
  const def = ONBOARDING_STEPS.find((s) => s.step === step);
  if (!def) throw new Error(`Unknown onboarding step ${step}`);
  return def;
}

/** The registry rows a step renders, in section/display order. */
export function onboardingStepFields(step: number): SapFieldDef[] {
  return onboardingStepDef(step).sections.flatMap((section) => section.fields.map(fieldDef));
}

/** Every field the applicant fills, across all four steps. */
export function onboardingApplicantFields(): SapFieldDef[] {
  return ONBOARDING_STEPS.flatMap((step) => onboardingStepFields(step.step));
}

// ---------------------------------------------------------------------------
// Validation — SAP type/length comes from the registry; the rules below are
// only the ones a SAP dictionary type cannot express (docs/05 §6.2).
// ---------------------------------------------------------------------------

type FieldRule = (value: string) => string | null;

const FIELD_RULES: Readonly<Record<string, FieldRule>> = {
  pan: (value) =>
    isValidPan(value)
      ? null
      : "PAN must be in the form AAAAA9999A (five letters, four digits, one letter).",
  gstin: (value) =>
    isValidGstin(value)
      ? null
      : "That GSTIN isn't valid. Check for typos — the last character is a checksum, so one wrong digit fails the whole number.",
  ifsc: (value) => (isValidIfsc(value) ? null : "IFSC must be 11 characters, e.g. HDFC0001234."),
  pinCode: (value) => (isValidPinCode(value) ? null : "PIN code must be 6 digits."),
  phone: (value) => (isValidPhone(value) ? null : "Phone must be 10-15 digits."),
  email: (value) =>
    z.string().email().safeParse(value).success ? null : "Enter a valid email address.",
  state: (value) => (value in GST_STATE_CODES ? null : "Select a state from the list."),
};

type OnboardingData = Record<string, unknown>;

export interface OnboardingIssue {
  /** `portalField` the message belongs against, for inline display. */
  field: string;
  message: string;
}

/**
 * Cross-field rules that only make sense once several steps are filled.
 * Kept separate from the per-field rules so a step-2 save can run them
 * against the *merged* draft (the state code lives on step 1) without the
 * step schema having to know about fields it doesn't render.
 */
export function onboardingCrossFieldIssues(data: OnboardingData): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const gstin = typeof data.gstin === "string" ? data.gstin.toUpperCase() : undefined;
  const pan = typeof data.pan === "string" ? data.pan.toUpperCase() : undefined;
  const state = typeof data.state === "string" ? data.state : undefined;

  if (!gstin || !isValidGstin(gstin)) return issues;

  if (pan && isValidPan(pan) && panFromGstin(gstin) !== pan) {
    issues.push({
      field: "gstin",
      message: `This GSTIN belongs to PAN ${panFromGstin(gstin)}, but you entered ${pan}. Check which one is right.`,
    });
  }

  const gstinState = stateCodeFromGstin(gstin);
  if (state && gstinState !== state) {
    // docs/05 §11 gives this exact error as the microcopy pattern example.
    issues.push({
      field: "gstin",
      message: `GSTIN state (${gstinState} — ${stateName(gstinState) ?? "unknown"}) doesn't match your billing state (${state} — ${stateName(state) ?? "unknown"}). Update the billing address or check the GSTIN.`,
    });
  }

  return issues;
}

/** Applies the per-field rules above to whichever fields a schema carries. */
function withFieldRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const data = (value ?? {}) as OnboardingData;
    for (const [field, rule] of Object.entries(FIELD_RULES)) {
      const raw = data[field];
      if (typeof raw !== "string" || raw.length === 0) continue;
      const message = rule(raw);
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  });
}

/** Per-step schema: registry-derived types/lengths + the field rules. */
export function onboardingStepSchema(step: number) {
  return withFieldRules(buildZodSchema(onboardingStepFields(step), "write"));
}

/** Everything the applicant submits, with cross-field rules applied too. */
export const onboardingWriteSchema = withFieldRules(
  buildZodSchema(onboardingApplicantFields(), "write"),
).superRefine((value, ctx) => {
  for (const issue of onboardingCrossFieldIssues(value as OnboardingData)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
  }
});

export type OnboardingApplicationInput = z.infer<typeof onboardingWriteSchema>;

/** Full shape as read back (includes SAP-populated fields once approved). */
export const onboardingReadSchema = buildZodSchema(onboardingMapping, "read");
export type OnboardingApplicationView = z.infer<typeof onboardingReadSchema>;

/** The decision fields the back-office supplies when approving (docs/03 Screen 1.4). */
export const onboardingApprovalSchema = buildZodSchema(
  onboardingMapping.filter((f) =>
    (ONBOARDING_INTERNAL_FIELDS as readonly string[]).includes(f.portalField),
  ),
  "write",
);
export type OnboardingApprovalInput = z.infer<typeof onboardingApprovalSchema>;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * What a verification attempt concluded. `unavailable` is deliberately not
 * a failure of the *applicant's* data: GSTN being down must not block a
 * registration (docs/05 P7), so it is the one non-verified outcome that
 * still lets the application through to review.
 */
export type GstinVerificationOutcome =
  "verified" | "mismatch" | "inactive" | "not_found" | "invalid" | "unavailable";

/** Outcomes that must stop the applicant from submitting. */
export const GSTIN_BLOCKING_OUTCOMES: readonly GstinVerificationOutcome[] = [
  "mismatch",
  "inactive",
  "not_found",
  "invalid",
];

export function isGstinBlocking(verification: GstinVerification | undefined): boolean {
  return verification ? GSTIN_BLOCKING_OUTCOMES.includes(verification.outcome) : false;
}

/** GSTN verification evidence, stored on the application (see ADR-010). */
export interface GstinVerification {
  gstin: string;
  outcome: GstinVerificationOutcome;
  verified: boolean;
  /** GSTN's legal name of business — echoed back for the applicant to confirm. */
  legalName?: string;
  tradeName?: string;
  stateCode?: string;
  /** GSTN taxpayer status, e.g. Active / Cancelled / Suspended. */
  taxpayerStatus?: string;
  registrationType?: string;
  /** Why verification failed, when it did — user-safe copy. */
  message?: string;
  checkedAt: string;
}

export interface OnboardingDocumentRef {
  kind: OnboardingDocumentKind;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

/** One entry on the `/register/status` timeline (docs/05 §7.1). */
export interface OnboardingEventRecord {
  at: Date;
  status: OnboardingApplicationStatus;
  note?: string;
}

export interface OnboardingApplication {
  id: string;
  tenantId: string;
  status: OnboardingApplicationStatus;
  data: Partial<OnboardingApplicationInput>;
  gstinVerification?: GstinVerification;
  documents: OnboardingDocumentRef[];
  events: OnboardingEventRecord[];
  salesOrg?: string;
  distributionChannel?: string;
  creditApprovalStatus?: string;
  sapCustomerCode?: string;
  rejectionReasons?: string[];
  reviewNote?: string;
  submittedAt?: Date;
  decidedAt?: Date;
}

/**
 * Allowed workflow transitions (docs/03 Module 1 process flow). Declared as
 * data so the service asks the registry rather than growing a `switch`, and
 * so the same table documents the flow for anyone reading it.
 *
 * `PendingApproval -> Draft` is the "Request More Info" path: the
 * application goes back to the applicant with the reviewer's note, and they
 * re-submit the same record rather than starting again.
 */
export const ONBOARDING_TRANSITIONS: Readonly<
  Record<OnboardingApplicationStatus, readonly OnboardingApplicationStatus[]>
> = {
  Draft: ["Draft", "Submitted"],
  Submitted: ["PendingApproval", "Rejected"],
  PendingApproval: ["Approved", "Rejected", "Draft"],
  Approved: [],
  Rejected: ["Draft"],
};

export function canTransition(
  from: OnboardingApplicationStatus,
  to: OnboardingApplicationStatus,
): boolean {
  return ONBOARDING_TRANSITIONS[from].includes(to);
}

/** True once the applicant can no longer edit their submission. */
export function isOnboardingLocked(status: OnboardingApplicationStatus): boolean {
  return status === "Submitted" || status === "PendingApproval" || status === "Approved";
}
