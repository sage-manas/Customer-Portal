import { NotImplementedSapAdapter } from "./not-implemented";

/**
 * S/4HANA driver — OData v2/v4 over SAP Cloud Connector / BTP destination
 * (docs/02-TRD-ARCHITECTURE.md §4.4).
 *
 * Target service map (docs/03 "Cross-cutting SAP integration summary"):
 *   createCustomer   -> Business Partner API (A_BusinessPartner)
 *   getMaterials     -> API_PRODUCT_SRV
 *   getStock         -> ATP / API_MATERIAL_STOCK_SRV
 *   sales orders     -> API_SALES_ORDER_SRV
 *   deliveries       -> API_OUTBOUND_DELIVERY_SRV
 *   invoices         -> API_BILLING_DOCUMENT_SRV
 *   AR               -> AR line-item / Journal Entry APIs
 *
 * Built in Phase 7 (docs/06 build order). Until then every call throws a
 * typed `not_implemented` SapError.
 */
export interface S4ConnectionConfig {
  /** Base URL of the OData gateway (or the BTP destination name). */
  baseUrl: string;
  /** Resolved from the per-tenant encrypted secret store, never inline. */
  credentialsRef: string;
  /** Sales area used for pricing/order calls. */
  salesOrg?: string;
  distributionChannel?: string;
}

export class S4SapAdapter extends NotImplementedSapAdapter {
  readonly driver = "s4" as const;

  constructor(readonly config: S4ConnectionConfig) {
    super();
  }
}
