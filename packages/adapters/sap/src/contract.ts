import type {
  CanonicalCustomer,
  ConfirmPodInput,
  ConfirmPodResult,
  ConvertQuotationInput,
  CreateInquiryInput,
  CreateQuotationInput,
  CreateSalesOrderInput,
  CreditInfo,
  CustomerCreateResult,
  CustomerPrice,
  Delivery,
  IncomingPaymentInput,
  IncomingPaymentResult,
  Inquiry,
  Invoice,
  Material,
  MaterialQuery,
  OpenItem,
  OrderSimulation,
  OrderStatusView,
  Page,
  Quotation,
  RebateAgreement,
  SalesOrderResult,
  ShipToAddress,
  StockLevel,
} from "@cc/domain";

/**
 * The canonical SAP API the whole application consumes
 * (docs/02-TRD-ARCHITECTURE.md §4.1). Three drivers implement it: `mock`
 * (built first — full simulation, so nothing blocks on SAP access), `ecc`
 * (RFC/BAPI) and `s4` (OData).
 *
 * App and service code must never import a driver directly — resolve one
 * per tenant through `createSapAdapter` (factory.ts). Drivers throw
 * `SapError` (errors.ts); they never return raw BAPIRET2/OData payloads.
 */

/**
 * How fresh a read is, per docs/05-UI-UX-DESIGN.md §6.1 — this is what
 * `SapSyncIndicator` renders. Every read carries it rather than the UI
 * guessing: principle P1, "the UI is honest about it". Caching itself
 * lives above the driver (cache-aside per docs/02 §4.3); a driver reports
 * `live` for a call it actually made, `stale` for a degraded/cached answer
 * served while SAP was unreachable.
 */
export type FreshnessClass = "live" | "cached" | "stale";

export interface SapRead<T> {
  data: T;
  freshness: FreshnessClass;
  /** ISO timestamp the underlying data was read from SAP. */
  syncedAt: string;
}

export interface SapConnectionHealth {
  reachable: boolean;
  driver: SapDriverName;
  /** Circuit-breaker state per tenant connection (docs/02 §4.3). */
  circuit: "closed" | "open" | "half-open";
  checkedAt: string;
}

export type SapDriverName = "mock" | "ecc" | "s4";

export interface SapAdapter {
  readonly driver: SapDriverName;

  /** Cheap probe used by the stale-data banner and ops health checks. */
  health(): Promise<SapConnectionHealth>;

  // ---- Master data: customer -------------------------------------------
  /** ECC: BAPI_CUSTOMER_CREATEFROMDATA1 · S/4: Business Partner API. */
  createCustomer(customer: CanonicalCustomer): Promise<CustomerCreateResult>;
  getCustomer(kunnr: string): Promise<SapRead<CanonicalCustomer>>;
  getShipToAddresses(kunnr: string): Promise<SapRead<ShipToAddress[]>>;
  /** KNKK / credit management API. */
  getCreditInfo(kunnr: string): Promise<SapRead<CreditInfo>>;
  /**
   * KONA — the customer's rebate agreements and what has accrued under each
   * (docs/03 Screen 9.2). A read only: agreements are created in VBO1 and
   * settled in VBO2, and the accrual is SAP's own arithmetic over the billing
   * documents. There is deliberately no portal-side equivalent, because a
   * second computation of money owed to a customer is a second answer.
   */
  getRebateAgreements(kunnr: string): Promise<SapRead<RebateAgreement[]>>;

  // ---- Master data: catalogue ------------------------------------------
  /** MARA/MAKT reads · API_PRODUCT_SRV. */
  getMaterials(query?: MaterialQuery): Promise<SapRead<Page<Material>>>;
  getMaterial(material: string): Promise<SapRead<Material>>;
  /** MARD-LABST / ATP API. Real-time class read — always `live`. */
  getStock(material: string, plant?: string): Promise<SapRead<StockLevel[]>>;
  /** Pricing simulation or VK13 condition reads — customer-specific. */
  getCustomerPrice(
    kunnr: string,
    material: string,
    quantity: number,
  ): Promise<SapRead<CustomerPrice>>;

  // ---- Pre-sales: inquiry & quotation -----------------------------------
  /** VA11 · BAPI_INQUIRY_CREATEFROMDATA2 — the customer's question. */
  createInquiry(input: CreateInquiryInput): Promise<Inquiry>;
  /** The inquiries of one sold-to account (docs/03 Screen 3.1). */
  getInquiries(kunnr: string): Promise<SapRead<Page<Inquiry>>>;
  getInquiry(vbeln: string): Promise<SapRead<Inquiry>>;
  /**
   * Inquiries across the tenant that no quotation answers yet — the
   * back-office workbench's queue (docs/05 §7.3).
   *
   * A separate method rather than an optional KUNNR on `getInquiries`,
   * deliberately: the customer-plane read must not be one forgotten argument
   * away from returning every customer's inquiries, and a boundary that
   * depends on a caller passing a parameter is not a boundary (ADR-025's
   * reasoning, applied to a read).
   */
  getInquiryQueue(): Promise<SapRead<Page<Inquiry>>>;
  /** VA21 · BAPI_QUOTATION_CREATEFROMDATA2 — sales answering an inquiry. */
  createQuotation(input: CreateQuotationInput): Promise<Quotation>;
  getQuotations(kunnr: string): Promise<SapRead<Page<Quotation>>>;
  getQuotation(vbeln: string): Promise<SapRead<Quotation>>;
  /**
   * The customer asking for the quotation to be reworked or revalidated
   * (docs/05 §7.3). Recorded against the document as sales text — a message
   * about a SAP document belongs on it, not in a portal table.
   */
  requestQuotationRevision(vbeln: string, comment: string): Promise<Quotation>;
  /**
   * VA01 with reference to the quotation (copy control). Returns the sales
   * order exactly as `createSalesOrder` does, because that is what it is —
   * the reference is how it was created, not a different kind of document.
   */
  convertQuoteToOrder(input: ConvertQuotationInput): Promise<SalesOrderResult>;

  // ---- Sales documents --------------------------------------------------
  /** BAPI_SALESORDER_CREATEFROMDAT2 in SIMULATE mode — ATP + credit preview. */
  simulateOrder(input: CreateSalesOrderInput): Promise<OrderSimulation>;
  /** BAPI_SALESORDER_CREATEFROMDAT2 · API_SALES_ORDER_SRV. */
  createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderResult>;
  /**
   * VA02 rejection (BAPI_SALESORDER_CHANGE with VBAP-ABGRU on every item).
   * Only an order SAP still reports as fully open can be withdrawn — once a
   * delivery exists the customer has to ask, not cancel (docs/05 §7.4).
   */
  cancelSalesOrder(vbeln: string, reason?: string): Promise<SalesOrderResult>;
  getOrderStatus(vbeln: string): Promise<SapRead<OrderStatusView>>;
  getOrders(kunnr: string): Promise<SapRead<Page<OrderStatusView>>>;

  // ---- Delivery ---------------------------------------------------------
  /**
   * LIKP/LIPS for one sold-to account (docs/03 Module 5). Keyed by KUNNR,
   * which is also the ownership boundary — the delivery module's list is a
   * customer's shipments, not one order's.
   */
  getDeliveries(kunnr: string): Promise<SapRead<Page<Delivery>>>;
  /** The deliveries created from one sales order (LIKP-VGBEL). */
  getDeliveriesForOrder(vbeln: string): Promise<SapRead<Delivery[]>>;
  /** LIKP/LIPS + VBUK-WBSTK for one delivery note. */
  getDelivery(deliveryVbeln: string): Promise<SapRead<Delivery>>;
  /**
   * VLPOD — the customer's proof of delivery (LIKP-KOQUK + LIPS-LFIMG
   * differences). A write, so it carries no freshness (ADR-007); SAP owns
   * the receipt itself, while the portal keeps the evidence around it
   * (ADR-026).
   */
  confirmPod(input: ConfirmPodInput): Promise<ConfirmPodResult>;

  // ---- Billing ----------------------------------------------------------
  getInvoices(kunnr: string): Promise<SapRead<Page<Invoice>>>;
  getInvoice(vbeln: string): Promise<SapRead<Invoice>>;
  /** Returns a URL/stream reference to the rendered billing document. */
  getInvoicePdf(vbeln: string): Promise<string>;

  // ---- Accounts receivable ----------------------------------------------
  /** BAPI_AR_ACC_GETOPENITEMS. */
  getOpenItems(kunnr: string): Promise<SapRead<OpenItem[]>>;
  /** F-28 equivalent posting + clearing. Idempotent on `gatewayReference`. */
  postIncomingPayment(input: IncomingPaymentInput): Promise<IncomingPaymentResult>;
}

/** Helper for drivers: wrap a value with its freshness metadata. */
export function sapRead<T>(
  data: T,
  freshness: FreshnessClass = "live",
  syncedAt: Date = new Date(),
): SapRead<T> {
  return { data, freshness, syncedAt: syncedAt.toISOString() };
}

/**
 * A composed read is only as fresh as its least-fresh part (ADR-007). Every
 * service that stitches several reads into one screen goes through here
 * rather than picking one part's freshness and hoping — the rule belongs to
 * the freshness contract, so it lives with it rather than once per service.
 */
export function leastFresh(
  reads: ReadonlyArray<Pick<SapRead<unknown>, "freshness">>,
): FreshnessClass {
  if (reads.some((read) => read.freshness === "stale")) return "stale";
  if (reads.some((read) => read.freshness === "cached")) return "cached";
  return "live";
}

export function earliestSyncedAt(reads: ReadonlyArray<Pick<SapRead<unknown>, "syncedAt">>): string {
  const stamps = reads.map((read) => read.syncedAt).sort();
  return stamps[0] ?? new Date().toISOString();
}
