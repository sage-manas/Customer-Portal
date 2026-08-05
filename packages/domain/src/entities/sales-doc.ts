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

/**
 * VA11 / BAPI_INQUIRY_CREATEFROMDATA2 — what the portal sends when a customer
 * asks for a price (docs/03 Screen 3.1). No price on the line: an inquiry is
 * the question, and the quotation is where sales answers it.
 */
export interface CreateInquiryInput {
  kunnr: string;
  /** VBAK-VDATU, ISO date */
  requiredDeliveryDate: string;
  /** VBAK-ANGDT — how long the customer needs the quotation to stand for. */
  validityDays?: number;
  /** STXH-TDLINE header sales text. */
  notes?: string;
  lines: Array<Pick<SalesDocLine, "material" | "quantity" | "uom">>;
}

export interface Inquiry {
  /** VBAK-VBELN */
  vbeln: string;
  kunnr: string;
  /** VBAK-ERDAT, ISO date */
  createdOn: string;
  requiredDeliveryDate: string;
  validityDays?: number;
  notes?: string;
  /** Derived from VBUK-GBSTK: open until a quotation references it. */
  status: CanonicalStatus;
  lines: SalesDocLine[];
  /**
   * VBFA — the quotation raised against this inquiry, once sales has issued
   * one. Its presence is what "Quotation received" means on the list
   * (docs/05 §7.3); the portal stores no flag of its own for it.
   */
  quotation?: string;
}

/**
 * VA21 — the sales-side answer (docs/03 Screen 3.2).
 *
 * Tax is carried as SAP calculated it (KONV, exactly as on `Invoice`): the
 * portal never computes GST (docs/02 §5), so a quotation's gross value is
 * SAP's number or it is nothing.
 */
export interface Quotation {
  /** VBAK-VBELN */
  vbeln: string;
  kunnr: string;
  /** VBAK-ERDAT, ISO date */
  createdOn: string;
  /** VBAK-BNDDT — the offer lapses after this date. */
  validUntil: string;
  /** VBAK-VGBEL — the inquiry it answers, when it came from one. */
  inquiry?: string;
  status: CanonicalStatus;
  lines: SalesDocLine[];
  /** VBAP-MWSK1, per line in SAP; uniform across the document in practice. */
  taxCode?: string;
  /** VBAK-NETWR — net of tax. */
  netValue: number;
  /** KONV-KBETR for JOCG / JOSG / JOIG, as on a billing document (ADR-018). */
  cgst: number;
  sgst: number;
  igst: number;
  /** Net + tax, the figure the customer commits to. */
  grossValue: number;
  currency: string;
  /** VA01-with-reference: the order this quotation became, once accepted. */
  salesOrder?: string;
  /**
   * Revision requests the customer has sent (docs/05 §7.3 "Request
   * Revision"). Held on the document as sales text rather than as a portal
   * row — it is a message about the quotation, and the quotation is SAP's.
   */
  revisionRequests?: Array<{ requestedOn: string; comment: string }>;
}

/** VA21 input — the back-office workbench issuing a quotation. */
export interface CreateQuotationInput {
  /** The inquiry being answered (VBAK-VGBEL on the quotation). */
  inquiryVbeln: string;
  /** VBAK-BNDDT, ISO date. */
  validUntil: string;
  /** Per-line net price. Omitted lines are priced from condition records. */
  lines?: Array<{ lineNo: number; netPrice: number }>;
}

/** VA01 with reference to a quotation (copy control). */
export interface ConvertQuotationInput {
  quotationVbeln: string;
  /** VBKD-BSTNK — the customer's own PO reference for the resulting order. */
  customerPoRef?: string;
  /** VBAK-VDATU; defaults to the quotation's own required date. */
  requestedDeliveryDate?: string;
  /** VBPA-KUNNR partner SH. */
  shipTo: string;
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
  /**
   * LIKP-KUNAG — the sold-to account. Carried on the delivery itself rather
   * than resolved through `salesOrder`, because this is the field the
   * ownership check compares against and a check that needs a second SAP
   * read is a check that fails open when SAP is slow (ADR-025).
   */
  kunnr: string;
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
  /**
   * LIKP-KOQUK — has the customer confirmed receipt (VLPOD)? SAP owns this
   * flag, which is why the portal posts to it rather than keeping its own
   * idea of whether the goods arrived (ADR-026).
   */
  podConfirmed?: boolean;
  /** Date the customer says the goods arrived, once POD has been posted. */
  podReceiptDate?: string;
  lines: SalesDocLine[];
}

/** A POD line as the customer submits it (LIPS-LFIMG, received vs dispatched). */
export interface PodLineInput {
  lineNo: number;
  receivedQty: number;
}

/** VLPOD — what the portal posts to SAP when a customer confirms receipt. */
export interface ConfirmPodInput {
  deliveryVbeln: string;
  /** ISO date the goods were received. */
  receiptDate: string;
  lines: PodLineInput[];
}

export interface ConfirmPodResult {
  deliveryVbeln: string;
  status: CanonicalStatus;
  /** True when SAP recorded a quantity difference on at least one line. */
  discrepancy: boolean;
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

/**
 * Money going the other way: the AP desk paying out a credit note (F-58 /
 * F-53 outgoing payment with clearing). The mirror of `IncomingPaymentInput`,
 * and separate from it for the reason the planes are separate everywhere else
 * — a function that could pay *or* collect depending on a sign is one typo
 * away from moving money in the wrong direction (doc 09 §3.4).
 */
export interface OutgoingPaymentInput {
  kunnr: string;
  /** The credit note's FI item (BSID-BELNR) being settled. */
  documentNumber: string;
  amount: number;
  currency: string;
  /**
   * The idempotency key, minted by the portal from the document being paid
   * rather than randomly — a double-clicked Pay must be one payout, and a key
   * the caller generates fresh each time would make it two (ADR-021's rule).
   */
  reference: string;
  /**
   * Who authorised it, carried onto the FI document's header text (BKPF-BKTXT).
   * The portal's technical user is what SAP would otherwise record as the
   * creator, which would lose the only fact worth auditing here.
   */
  initiatedBy?: string;
  note?: string;
}

export interface OutgoingPaymentResult {
  /** The FI payment document created by the posting. */
  documentNumber: string;
  clearedItems: string[];
  paidAmount: number;
  currency: string;
  /** BKPF-BUDAT, ISO date. */
  postingDate: string;
}

/** VKM3 — releasing an order SAP is holding on credit (doc 05 §8). */
export interface CreditReleaseInput {
  vbeln: string;
  initiatedBy?: string;
  note?: string;
}

/**
 * What VKM3 actually does, represented honestly: it **re-runs the credit
 * check**. An order over a limit that has not moved comes back still held,
 * and `released: false` with SAP's reason is the truthful answer — a portal
 * that reported success regardless would have a warehouse expecting a pick
 * SAP is still blocking.
 */
export interface CreditReleaseResult {
  vbeln: string;
  released: boolean;
  /** VBUK-CMGST as it stands after the re-check. */
  creditStatus: CanonicalStatus;
  /** Why it is still held, when it is. */
  reason?: string;
}
