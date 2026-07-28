import type { CanonicalStatus } from "../status";

/**
 * Canonical sales-document shapes for the SAP adapter contract
 * (docs/02-TRD-ARCHITECTURE.md §4.1, docs/03-FUNCTIONAL-SPEC.md Modules 3-7).
 *
 * Note what is *absent*: raw SAP status codes. Drivers translate GBSTK /
 * CMGST / WBSTK into `CanonicalStatus` via @cc/domain/status before
 * returning, so no consumer ever switches on a SAP code (CLAUDE.md rule 3).
 */

export interface SalesDocLine {
  lineNo: number;
  /** VBAP-MATNR */
  material: string;
  description?: string;
  /** VBAP-KWMENG */
  quantity: number;
  /** VBAP-VRKME */
  uom: string;
  /** VBAP-NETPR — ex-GST */
  netPrice: number;
  /** Extended net value for the line. */
  netValue: number;
  /** VBAP-WERKS */
  plant?: string;
  /** VBEP-BMENG / EDATU — confirmed schedule line, once ATP has run. */
  confirmedQty?: number;
  confirmedDate?: string;
}

export interface CreateSalesOrderInput {
  kunnr: string;
  /** VBKD-BSTNK — also the portal idempotency key (docs/02 §4.3). */
  customerPoRef?: string;
  /** VBAK-VDATU, ISO date */
  requestedDeliveryDate: string;
  /** VBPA-KUNNR, partner function SH */
  shipTo: string;
  /** VBKD-ZTERM / INCO1, VBAK-LPRIO */
  paymentTerms?: string;
  incoterms?: string;
  deliveryPriority?: string;
  lines: Array<Pick<SalesDocLine, "material" | "quantity" | "uom"> & { netPrice?: number }>;
  /** Set when converting an accepted quotation (VA01 with reference). */
  referenceQuotation?: string;
}

export interface SalesOrderResult {
  /** VBAK-VBELN */
  vbeln: string;
  orderStatus: CanonicalStatus;
  creditStatus: CanonicalStatus;
  lines: SalesDocLine[];
  netValue: number;
  currency: string;
}

/** Result of BAPI_SALESORDER_CREATEFROMDAT2 in SIMULATE mode / the ATP API. */
export interface OrderSimulation {
  lines: Array<{
    lineNo: number;
    material: string;
    requestedQty: number;
    confirmedQty: number;
    confirmedDate: string;
    /** True when SAP could not confirm the full requested quantity. */
    partial: boolean;
  }>;
  netValue: number;
  currency: string;
  /** Would this order breach the credit limit (KNKK) if submitted? */
  creditBlockExpected: boolean;
}

export interface OrderStatusView {
  vbeln: string;
  kunnr: string;
  /** VBAK-ERDAT, ISO date */
  createdOn: string;
  customerPoRef?: string;
  /** Derived from VBUK-GBSTK */
  orderStatus: CanonicalStatus;
  /** Derived from VBUK-CMGST */
  creditStatus: CanonicalStatus;
  lines: SalesDocLine[];
  netValue: number;
  currency: string;
  /** NAST/BA00 order-confirmation output, when generated. */
  confirmationPdfUrl?: string;
  /** VBAP-ABGRU text, set when every item was rejected (a cancellation). */
  rejectionReason?: string;
}

export interface Delivery {
  /** LIKP-VBELN */
  vbeln: string;
  /** LIKP-VGBEL — the sales order it was created from. */
  salesOrder: string;
  /** Derived from VBUK-WBSTK */
  status: CanonicalStatus;
  /** LIKP-WADAT / WADAT_IST, ISO dates */
  plannedGoodsIssue?: string;
  actualGoodsIssue?: string;
  /** LIKP-TDLNR */
  carrier?: string;
  /** LIKP-TRAID */
  trackingNumber?: string;
  /** J_1IEXCHDR-J_1IEWB_NO — mandatory above Rs 50,000. */
  ewayBillNumber?: string;
  lines: SalesDocLine[];
}

export interface Invoice {
  /** VBRK-VBELN */
  vbeln: string;
  /** VBRK-FKDAT, ISO date */
  billingDate: string;
  /** VBRP-VGBEL — preceding delivery/order */
  reference?: string;
  kunnr: string;
  /**
   * VBRK-FKART — F2 invoice / G2 credit note / L2 debit note. A note is a
   * billing document like any other, so it travels on this type rather than
   * a parallel one (ADR-020); `billingKind` in entities/ar.ts classifies it.
   */
  billingType?: string;
  /** VBRP-MGAGR — why a credit/debit note was raised (docs/03 Screen 6.2). */
  reasonCode?: string;
  /** VBRP-NETWR — taxable, ex-GST */
  taxableAmount: number;
  /** KONV-KBETR for JOCG / JOSG / JOIG. Intra-state fills cgst+sgst, inter-state igst. */
  cgst: number;
  sgst: number;
  igst: number;
  grossAmount: number;
  currency: string;
  /** BSID-ZFBDT + terms, ISO date */
  dueDate: string;
  status: CanonicalStatus;
  /** J_1IEXCHDR-J_1I_IRN — 64 chars */
  irn?: string;
  pdfUrl?: string;
}

/** BSID open item (BAPI_AR_ACC_GETOPENITEMS). */
export interface OpenItem {
  /** BSID-BELNR */
  documentNumber: string;
  /** BKPF-BLART — RV invoice / DZ payment / G2 credit note */
  documentType: string;
  /** BKPF-BUDAT, ISO date */
  postingDate: string;
  dueDate: string;
  /** BSID-DMBTR */
  amount: number;
  openAmount: number;
  currency: string;
  status: CanonicalStatus;
  /** BSEG-AUGBL — set once cleared. */
  clearingDocument?: string;
}

export interface IncomingPaymentInput {
  kunnr: string;
  amount: number;
  currency: string;
  /** BSEG-KIDNO — payment gateway reference; the idempotency key. */
  gatewayReference: string;
  /** Items to clear, with the amount applied to each (partial supported). */
  allocations: Array<{ documentNumber: string; amount: number }>;
}

export interface IncomingPaymentResult {
  /** The FI document created by the F-28 equivalent posting. */
  documentNumber: string;
  clearedItems: string[];
  /** Items left partially open after allocation (residual). */
  residualItems: string[];
}
