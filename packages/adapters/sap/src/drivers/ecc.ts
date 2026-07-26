import { NotImplementedSapAdapter } from "./not-implemented";

/**
 * ECC driver — RFC/BAPI over `node-rfc` or, preferably, the outbound-only
 * on-prem connector agent (docs/02-TRD-ARCHITECTURE.md §4.4 recommends the
 * agent: the SAP NW RFC SDK binary is awkward on managed PaaS).
 *
 * Target call map (docs/03 "Cross-cutting SAP integration summary"):
 *   createCustomer      -> BAPI_CUSTOMER_CREATEFROMDATA1
 *   getMaterials/Stock  -> MARA/MAKT/MARD reads
 *   getCustomerPrice    -> VK13 condition reads / order simulation
 *   simulateOrder       -> BAPI_SALESORDER_CREATEFROMDAT2 (SIMULATE)
 *   createSalesOrder    -> BAPI_SALESORDER_CREATEFROMDAT2 + BAPI_TRANSACTION_COMMIT
 *   getOpenItems        -> BAPI_AR_ACC_GETOPENITEMS
 *   postIncomingPayment -> F-28 equivalent posting + clearing
 *
 * Built in Phase 7 (docs/06 build order). Until then every call throws a
 * typed `not_implemented` SapError.
 */
export interface EccConnectionConfig {
  /** Connector-agent endpoint, or the RFC destination when in-process. */
  endpoint: string;
  client: string;
  sysnr?: string;
  /** Resolved from the per-tenant encrypted secret store, never inline. */
  credentialsRef: string;
}

export class EccSapAdapter extends NotImplementedSapAdapter {
  readonly driver = "ecc" as const;

  constructor(readonly config: EccConnectionConfig) {
    super();
  }
}
