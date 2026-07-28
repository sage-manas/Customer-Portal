import type {
  CanonicalCustomer,
  CreateSalesOrderInput,
  CreditInfo,
  CustomerCreateResult,
  CustomerPrice,
  Delivery,
  IncomingPaymentInput,
  IncomingPaymentResult,
  Invoice,
  Material,
  MaterialQuery,
  OpenItem,
  OrderSimulation,
  OrderStatusView,
  Page,
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
  getDeliveries(vbeln: string): Promise<SapRead<Delivery[]>>;
  getDeliveryDetail(deliveryVbeln: string): Promise<SapRead<Delivery>>;

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
