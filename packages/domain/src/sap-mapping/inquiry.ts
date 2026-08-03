import type { SapFieldDef } from "./types";

/**
 * Module 3 — Inquiry & Quotation.
 * Source: docs/03-FUNCTIONAL-SPEC.md, Screens 3.1-3.2.
 *
 * Both documents are VBAK/VBAP sales documents, so the line fields are the
 * same ones the order registry declares — they are repeated here rather than
 * imported because the two screens are allowed to diverge (an inquiry line
 * carries no price, an order line does) and a shared list would make that
 * divergence invisible.
 */
export const inquiryMapping: readonly SapFieldDef[] = [
  // Screen 3.1 — Raise Inquiry: Header
  {
    portalField: "inquiryType",
    label: "Inquiry Type",
    sapTable: "VBAK",
    sapField: "AUART",
    sapType: "CHAR",
    length: 4,
    required: "R",
    notes: 'Fixed "IN" — the customer never chooses a document type',
  },
  {
    portalField: "requiredDeliveryDate",
    label: "Required Delivery Date",
    sapTable: "VBAK",
    sapField: "VDATU",
    sapType: "DATS",
    required: "M",
  },
  {
    portalField: "validityDays",
    label: "Validity Days",
    sapTable: "VBAK",
    sapField: "ANGDT",
    sapType: "NUMC",
    length: 3,
    required: "O",
    notes: "How long the customer needs the quotation to stand for",
  },
  {
    portalField: "notes",
    label: "Requirements",
    sapTable: "STXH",
    sapField: "TDLINE",
    sapType: "TEXT",
    length: 2000,
    required: "O",
    notes: "Header sales text",
  },

  // Screen 3.1 — Raise Inquiry: Line items
  {
    portalField: "material",
    label: "Material",
    sapTable: "VBAP",
    sapField: "MATNR",
    sapType: "CHAR",
    length: 18,
    required: "M",
  },
  {
    portalField: "quantity",
    label: "Quantity",
    sapTable: "VBAP",
    sapField: "KWMENG",
    sapType: "QUAN",
    length: 13,
    required: "M",
    notes: "Triggers ATP",
  },
  {
    portalField: "uom",
    label: "UoM",
    sapTable: "VBAP",
    sapField: "VRKME",
    sapType: "UNIT",
    length: 3,
    required: "M",
  },

  // Screen 3.2 — View Quotation (read-only)
  {
    portalField: "quotationNumber",
    label: "Quotation No.",
    sapTable: "VBAK",
    sapField: "VBELN",
    sapType: "CHAR",
    length: 10,
    required: "R",
  },
  {
    portalField: "quotationDate",
    label: "Date",
    sapTable: "VBAK",
    sapField: "ERDAT",
    sapType: "DATS",
    required: "R",
  },
  {
    portalField: "validUntil",
    label: "Valid Until",
    sapTable: "VBAK",
    sapField: "BNDDT",
    sapType: "DATS",
    required: "R",
    notes: "Countdown chip turns amber inside the warning window (docs/05 §7.3)",
  },
  {
    portalField: "unitPrice",
    label: "Unit Price",
    sapTable: "VBAP",
    sapField: "NETPR",
    sapType: "CURR",
    length: 11,
    required: "R",
    notes: "Ex-GST",
  },
  {
    portalField: "taxCode",
    label: "Tax Code",
    sapTable: "VBAP",
    sapField: "MWSK1",
    sapType: "CHAR",
    length: 2,
    required: "R",
  },
  {
    portalField: "quotationTotal",
    label: "Total",
    sapTable: "VBAK",
    sapField: "NETWR",
    sapType: "CURR",
    length: 15,
    required: "R",
    notes: "Incl. GST, as SAP calculated it — the portal never computes tax",
  },
] as const;
