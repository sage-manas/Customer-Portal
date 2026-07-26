/**
 * Canonical status vocabulary, per docs/05-UI-UX-DESIGN.md §6.5.
 * Components render `CanonicalStatus` + `BadgeVariant` only — raw SAP
 * status codes (VBUK-GBSTK, CMGST, WBSTK, ...) are translated to this
 * enum here, and nowhere else.
 */
export const CANONICAL_STATUSES = [
  "Draft",
  "Submitted",
  "PendingApproval",
  "Approved",
  "Rejected",
  "Open",
  "Confirmed",
  "CreditHold",
  "InProcess",
  "Picked",
  "Packed",
  "InTransit",
  "Delivered",
  "PartiallyDelivered",
  "Invoiced",
  "Overdue",
  "Paid",
  "Cleared",
  "Disputed",
  "Resolved",
  "Closed",
] as const;

export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * StatusBadge color mapping. Explicit assignments quote docs/05 §3.2
 * verbatim ("Confirmed/Released -> success", etc). Statuses the design
 * doc didn't explicitly enumerate (Submitted, Approved, Picked, Packed,
 * Invoiced, Disputed, Resolved, Closed) are reasoned extensions of the
 * same rule (milestone/in-flight -> info, needs-action -> danger,
 * favorable-terminal -> success, archived -> neutral) — see inline notes.
 */
export const statusBadgeVariant: Record<CanonicalStatus, BadgeVariant> = {
  Draft: "neutral",
  Submitted: "info", // in flight, awaiting internal action
  PendingApproval: "warning", // "Pending -> warning" per doc
  Approved: "success",
  Rejected: "danger",
  Open: "warning",
  Confirmed: "success", // "Confirmed/Released -> success" per doc
  CreditHold: "danger", // "Credit Hold -> danger" per doc
  InProcess: "info", // "In Process -> info" per doc
  Picked: "info",
  Packed: "info",
  InTransit: "info", // "In Transit -> info" per doc
  Delivered: "success", // "Delivered -> success" per doc
  PartiallyDelivered: "warning", // "Partial -> warning" per doc
  Invoiced: "info",
  Overdue: "danger", // "Overdue -> danger" per doc
  Paid: "success", // "Paid -> success" per doc
  Cleared: "success", // "Cleared -> success" per doc
  Disputed: "danger",
  Resolved: "success",
  Closed: "neutral",
};

/**
 * Module 4 — VBUK-GBSTK (overall order status): A Open / B Partial / C Complete.
 */
export function mapOrderGbstkToStatus(code: "A" | "B" | "C"): CanonicalStatus {
  switch (code) {
    case "A":
      return "Open";
    case "B":
      return "PartiallyDelivered";
    case "C":
      return "Closed";
  }
}

/**
 * Module 4 — VBUK-CMGST (credit status): A not checked / B blocked / C released.
 */
export function mapOrderCmgstToStatus(code: "A" | "B" | "C"): CanonicalStatus {
  switch (code) {
    case "A":
      return "Open";
    case "B":
      return "CreditHold";
    case "C":
      return "Confirmed";
  }
}

/** Module 1 — portal-native onboarding application workflow state. */
export type OnboardingApplicationStatus =
  "Draft" | "Submitted" | "PendingApproval" | "Approved" | "Rejected";

export function mapOnboardingStatusToCanonical(
  status: OnboardingApplicationStatus,
): CanonicalStatus {
  return status;
}
