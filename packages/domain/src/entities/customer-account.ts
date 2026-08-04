import { z } from "zod";

import { onboardingMapping } from "../sap-mapping/onboarding";
import { buildZodSchema } from "../sap-mapping/to-zod";
import type { SapFieldDef } from "../sap-mapping/types";

import { withOnboardingFieldRules } from "./onboarding";

/**
 * The customer account as the *portal* knows it (doc 09 §3.4, Phase 5).
 *
 * SAP owns the customer master — KNA1/KNVV, created by the onboarding
 * approval and read back per request, exactly as ADR-016 requires of every
 * other O2C document. What SAP has nowhere to put is whether this account
 * may still *use the portal*: a sold-to that is perfectly alive in SAP, still
 * receiving goods and still being invoiced, can have its portal access
 * withdrawn by the tenant without anything in the customer master changing.
 * That single fact is the one thing stored here, and it is stored per KUNNR
 * rather than per user because a user may act for several accounts and an
 * account may be reachable by several users (ADR-057).
 *
 * The status is *not* a `CanonicalStatus`: those describe SAP documents and
 * come from SAP codes (status.ts), and this comes from a tenant admin
 * clicking a button. Giving it its own two-value vocabulary keeps the
 * canonical registry honest about what it maps.
 */

export const CUSTOMER_ACCOUNT_STATUSES = ["Active", "Deactivated"] as const;
export type CustomerAccountStatus = (typeof CUSTOMER_ACCOUNT_STATUSES)[number];

export function customerAccountStatus(isActive: boolean): CustomerAccountStatus {
  return isActive ? "Active" : "Deactivated";
}

/** How the account came to exist — shown on the detail screen's provenance line. */
export type CustomerAccountOrigin = "self_registered" | "back_office";

/** One row of the `/admin/customers` list (doc 09 §3.4). */
export interface CustomerAccountSummary {
  kunnr: string;
  legalEntityName: string;
  gstin?: string;
  city?: string;
  state?: string;
  contactEmail?: string;
  status: CustomerAccountStatus;
  origin: CustomerAccountOrigin;
  /** Portal logins linked to this account; 0 means nobody can sign in for it. */
  userCount: number;
  registeredAt: Date;
  deactivatedAt?: Date;
  deactivationReason?: string;
}

/**
 * Why an account may not act, or `null` when it may.
 *
 * One function rather than an `isActive` check per call site, for the reason
 * `quotationAcceptBlock` exists (ADR-031): the *reason* is what the screen
 * and the API response have to say, and a boolean loses it. Login, the
 * account switcher and order creation all ask this.
 */
export function customerAccountBlock(account: {
  isActive: boolean;
  deactivatedAt?: Date | null;
}): string | null {
  if (account.isActive) return null;
  return "This account has been deactivated by your supplier. Existing documents stay available; contact your account manager to have it re-enabled.";
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * What a tenant admin may change on an existing customer, by `portalField`
 * name in display order (doc 09 §3.4 "edit").
 *
 * This is a **subset of the onboarding registry, not a second list of
 * fields**: every entry below resolves against `onboardingMapping`, so a
 * field's label, SAP provenance, type and length have exactly one
 * definition (CLAUDE.md rule 3) and the edit form renders from the same
 * `SapField` component the wizard does.
 *
 * What is deliberately absent is as load-bearing as what is present. PAN,
 * GSTIN and the GST registration type are not editable here: the GSTIN
 * carries GSTN verification evidence bound to that exact number (ADR-010),
 * it decides the place of supply behind every tax line SAP has already
 * computed on posted invoices, and a portal form that silently re-pointed it
 * would invalidate evidence and tax determination at once. Changing those is
 * a customer-master change with a paper trail, which is what XD02 and a
 * support ticket are for. The documents are absent for the same reason —
 * they are evidence of what was verified, not current-state fields.
 */
export const CUSTOMER_EDITABLE_FIELDS = [
  "tradeName",
  "street",
  "city",
  "state",
  "pinCode",
  "country",
  "contactPerson",
  "email",
  "phone",
] as const;

export type CustomerEditableField = (typeof CUSTOMER_EDITABLE_FIELDS)[number];

/** The registry rows the edit form renders, in display order. */
export function customerEditableFields(): SapFieldDef[] {
  return CUSTOMER_EDITABLE_FIELDS.map((portalField) => {
    const def = onboardingMapping.find((field) => field.portalField === portalField);
    // Same failure mode as ONBOARDING_STEPS': a name the registry doesn't
    // define is a bug in this pair, so it fails at import rather than
    // rendering an empty form in production.
    if (!def) throw new Error(`CUSTOMER_EDITABLE_FIELDS references unknown field "${portalField}"`);
    return def;
  });
}

/**
 * Sections the edit form groups the fields into. Mirrors the wizard's step-1
 * grouping, because it is the same data seen a second time.
 */
export const CUSTOMER_EDIT_SECTIONS: readonly { title: string; fields: readonly string[] }[] = [
  { title: "Company Identity", fields: ["tradeName"] },
  { title: "Billing Address", fields: ["street", "city", "state", "pinCode", "country"] },
  { title: "Primary Contact", fields: ["contactPerson", "email", "phone"] },
] as const;

/**
 * Validation for an edit. Registry-derived like every other schema in this
 * codebase, and carrying the same per-field rules the wizard applies — an
 * email that would have been rejected at registration must not become
 * acceptable because it arrived through a different screen.
 */
export const customerEditSchema = withOnboardingFieldRules(
  buildZodSchema(customerEditableFields(), "write"),
);

export type CustomerEditInput = z.infer<typeof customerEditSchema>;

/** Free-text reason a deactivation records. Optional, but bounded. */
export const customerDeactivationSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});
