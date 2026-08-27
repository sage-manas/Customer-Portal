import type { SapFieldDef } from "./types";

/**
 * Module 9 — Loyalty & Credit.
 * Source: docs/03-FUNCTIONAL-SPEC.md, Screens 9.1-9.2.
 *
 * Almost every field here is read-only (`R`): a credit position is SAP's
 * answer about the customer, not something the portal collects. The one
 * exception is `requestedCreditLimit`, which is what the customer asks for on
 * docs/05 §7.9's "Request Credit Limit Increase" form — and it is the same
 * KNKK-KLIMK the onboarding registry already declares, deliberately repeated
 * here for the reason the inquiry registry gives about order lines: the two
 * screens are allowed to diverge (onboarding asks a prospect with no history,
 * this asks an account with an exposure) and a shared row would hide it.
 */
export const loyaltyMapping: readonly SapFieldDef[] = [
  // Screen 9.1 — Credit Position
  {
    portalField: "creditLimit",
    label: "Approved Limit",
    sapTable: "KNKK",
    sapField: "KLIMK",
    sapType: "CURR",
    length: 15,
    required: "R",
    notes: "Maintained in FD32; the portal never writes it",
  },
  {
    portalField: "utilized",
    label: "Utilized",
    sapTable: "KNKK",
    sapField: "SKFOR",
    sapType: "CURR",
    length: 15,
    required: "R",
    notes: "Open orders + open AR, as SAP computes exposure",
  },
  {
    portalField: "creditBlockStatus",
    label: "Block Status",
    sapTable: "KNKK",
    sapField: "CTLPC",
    sapType: "STATUS",
    length: 3,
    required: "R",
  },
  {
    portalField: "requestedCreditLimit",
    label: "Requested Credit Limit",
    sapTable: "KNKK",
    sapField: "KLIMK",
    sapType: "CURR",
    length: 15,
    required: "M",
    notes: "Screen 9.1 action — approval-tracked in the portal, applied in FD32",
  },

  // Screen 9.2 — Loyalty & Rebates
  {
    portalField: "ytdPurchaseValue",
    label: "YTD Purchase Value",
    sapTable: "VBRK",
    sapField: "NETWR",
    sapType: "CURR",
    length: 15,
    required: "R",
    notes: "Aggregated over the fiscal year; the tier is derived from it",
  },
  {
    portalField: "rebateAgreement",
    label: "Rebate Agreement",
    sapTable: "KONA",
    sapField: "KNUMA",
    sapType: "CHAR",
    length: 10,
    required: "R",
    notes: "Created in VBO1, settled in VBO2",
  },
  {
    portalField: "accruedRebate",
    label: "Accrued Rebate",
    sapTable: "KONA",
    sapField: "KAWRT",
    sapType: "CURR",
    length: 15,
    required: "R",
  },
];
