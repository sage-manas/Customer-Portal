import "server-only";

import { sapNotImplemented, type SapAdapter } from "@/packages/sap-mock";
import { serverEnv } from "@/server/env";

import { createSapHttpClient, credentialsFromEnv, type SapHttpClient } from "./client";

/**
 * The real SAP driver.
 *
 * Every operation is declared and none is implemented — deliberately. The
 * application above this file is complete: routes, guards, validation,
 * services and the KUNNR boundary all work against the `SapAdapter` contract,
 * so wiring a landscape up is a matter of filling in the bodies below, one
 * operation at a time, with nothing else to change.
 *
 * What must NOT happen here is a fabricated response. A stub that returned a
 * plausible order number or an empty invoice list would make the portal look
 * finished while quietly telling customers things that are not true, and the
 * failure would surface as a reconciliation problem months later. Throwing is
 * the honest answer, and the UI already renders it: an unimplemented operation
 * arrives as a `not_implemented` SapError, which the services map to a 501/502
 * and the screens show as "temporarily unavailable" rather than as data.
 *
 * The SAP object each operation maps to is named on its line, because that is
 * the part that is genuinely hard to recover later.
 */

const DRIVER = "http";

/** TODO: SAP INTEGRATION — replace each call with a real request. */
function todo(operation: string): never {
  throw sapNotImplemented(DRIVER, operation);
}

export interface HttpSapDriverOptions {
  client?: SapHttpClient;
}

export function createHttpSapAdapter(options: HttpSapDriverOptions = {}): SapAdapter {
  // Constructed eagerly so a missing SAP_BASE_URL fails here, at driver
  // selection, rather than inside the first customer's request.
  const client = options.client ?? createSapHttpClient(credentialsFromEnv());
  void client;

  const adapter: SapAdapter = {
    // Reported as `s4` when configured for S/4 and `ecc` otherwise; the
    // contract has no name for "real but unimplemented", and inventing one
    // would mean every consumer had to learn it.
    driver: serverEnv.SAP_DRIVER === "s4" ? "s4" : "ecc",

    // -- Connection ---------------------------------------------------------
    // TODO: SAP INTEGRATION — a cheap ping (e.g. GET /sap/opu/odata/... $metadata).
    health: async () => todo("health"),

    // -- Customer master (KNA1/KNB1/KNVV · API_BUSINESS_PARTNER) ------------
    // TODO: SAP INTEGRATION
    createCustomer: async () => todo("createCustomer"), // BAPI_CUSTOMER_CREATEFROMDATA1
    updateCustomer: async () => todo("updateCustomer"), // XD02
    getCustomer: async () => todo("getCustomer"), // KNA1
    getShipToAddresses: async () => todo("getShipToAddresses"), // KNVP ship-to partners
    getCreditInfo: async () => todo("getCreditInfo"), // KNKK
    getRebateAgreements: async () => todo("getRebateAgreements"), // KONA
    getRebateRegister: async () => todo("getRebateRegister"), // KONA, tenant-wide
    settleRebateAgreement: async () => todo("settleRebateAgreement"), // VBO2 settlement

    // -- Material & pricing (MARA/MAKT/MARD · API_PRODUCT_SRV) --------------
    // TODO: SAP INTEGRATION
    getMaterials: async () => todo("getMaterials"),
    getMaterial: async () => todo("getMaterial"),
    getStock: async () => todo("getStock"), // MARD-LABST / ATP
    getCustomerPrice: async () => todo("getCustomerPrice"), // pricing simulation / VK13

    // -- Inquiries & quotations (VBAK AUART=IN / AG) -----------------------
    // TODO: SAP INTEGRATION
    createInquiry: async () => todo("createInquiry"), // VA11 · BAPI_INQUIRY_CREATEFROMDATA2
    getInquiries: async () => todo("getInquiries"), // one sold-to account only
    getInquiry: async () => todo("getInquiry"),
    getInquiryQueue: async () => todo("getInquiryQueue"), // tenant-wide sales desk
    createQuotation: async () => todo("createQuotation"), // VA21
    getQuotations: async () => todo("getQuotations"),
    getQuotation: async () => todo("getQuotation"),
    requestQuotationRevision: async () => todo("requestQuotationRevision"),
    convertQuoteToOrder: async () => todo("convertQuoteToOrder"),

    // -- Sales orders (VBAK/VBAP · API_SALES_ORDER_SRV) --------------------
    // TODO: SAP INTEGRATION
    simulateOrder: async () => todo("simulateOrder"), // BAPI_SALESORDER_CREATEFROMDAT2, SIMULATE
    createSalesOrder: async () => todo("createSalesOrder"), // BAPI_SALESORDER_CREATEFROMDAT2
    cancelSalesOrder: async () => todo("cancelSalesOrder"),
    getOrderStatus: async () => todo("getOrderStatus"),
    getOrders: async () => todo("getOrders"),
    getCreditBlockedOrders: async () => todo("getCreditBlockedOrders"), // VBUK-CMGST
    releaseCreditBlock: async () => todo("releaseCreditBlock"), // VKM3

    // -- Deliveries (LIKP/LIPS) -------------------------------------------
    // TODO: SAP INTEGRATION
    getDeliveries: async () => todo("getDeliveries"),
    getDeliveriesForOrder: async () => todo("getDeliveriesForOrder"), // LIKP-VGBEL
    getDelivery: async () => todo("getDelivery"),
    confirmPod: async () => todo("confirmPod"), // VLPOD

    // -- Billing (VBRK/VBRP/KONV) -----------------------------------------
    // TODO: SAP INTEGRATION
    getInvoices: async () => todo("getInvoices"),
    getInvoice: async () => todo("getInvoice"),
    getInvoicePdf: async () => todo("getInvoicePdf"), // GOS archive link
    getBillingRegister: async () => todo("getBillingRegister"), // tenant-wide

    // -- Finance (BSID/BSAD) ----------------------------------------------
    // TODO: SAP INTEGRATION
    getOpenItems: async () => todo("getOpenItems"), // BAPI_AR_ACC_GETOPENITEMS
    getOpenItemsLedger: async () => todo("getOpenItemsLedger"),
    postIncomingPayment: async () => todo("postIncomingPayment"), // F-28, idempotent on gatewayReference
    postOutgoingPayment: async () => todo("postOutgoingPayment"),
  };

  return adapter;
}
