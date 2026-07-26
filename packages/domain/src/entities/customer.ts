/**
 * Canonical customer shapes exchanged with the SAP adapter layer
 * (docs/02-TRD-ARCHITECTURE.md §4.1). These are *canonical* — driver-neutral
 * by design: the ECC driver maps them onto BAPI_CUSTOMER_CREATEFROMDATA1
 * structures, the S/4 driver onto the Business Partner API, the mock driver
 * onto its in-memory store. App and service code only ever sees these.
 *
 * Field-level SAP provenance lives in the sap-mapping registry
 * (sap-mapping/onboarding.ts) — not duplicated here.
 */

/** Sold-to / ship-to account as the portal knows it. KUNNR is the identity. */
export interface CanonicalCustomer {
  /** KNA1-KUNNR. Absent when the customer has not been created in SAP yet. */
  kunnr?: string;
  /** KNA1-NAME1 */
  legalEntityName: string;
  /** KNA1-NAME2 */
  tradeName?: string;
  /** KNA1-KTOKD — account group */
  customerType: string;
  address: CanonicalAddress;
  contact: CanonicalContact;
  tax: CanonicalTaxIds;
  /** KNVV-VKORG / VTWEG — assigned by the tenant at approval time. */
  salesOrg?: string;
  distributionChannel?: string;
  /** KNVV-ZTERM */
  paymentTerms?: string;
}

export interface CanonicalAddress {
  /** KNA1-STRAS */
  street: string;
  /** KNA1-ORT01 */
  city: string;
  /** KNA1-REGIO — T005S region code; drives GST place of supply. */
  region: string;
  /** KNA1-PSTLZ */
  postalCode: string;
  /** KNA1-LAND1 */
  country: string;
}

export interface CanonicalContact {
  /** KNA1-ANSPK */
  contactPerson: string;
  /** ADR6-SMTP_ADDR — also the portal login id. */
  email: string;
  /** KNA1-TELF1 */
  phone: string;
}

export interface CanonicalTaxIds {
  /** KNA1-STCD3 */
  pan: string;
  /** KNA1-STCD2 */
  gstin: string;
  /** J_1IMOCUST-J_1IGSTIN_REGTP */
  gstRegistrationType?: string;
  /** KNA1-STCD1 */
  cin?: string;
  /** KNA1-STCD4 */
  tan?: string;
  /** KNA1-STCD5 */
  udyam?: string;
}

/** Result of a create-customer write (BAPI / BP API / mock). */
export interface CustomerCreateResult {
  kunnr: string;
  /** Echo of what SAP actually stored, after its own field truncation. */
  customer: CanonicalCustomer;
}

/**
 * Credit position (KNKK). `available` is computed, not read — SAP exposes
 * limit and exposure; the portal derives the rest (docs/03 Screen 9.1).
 */
export interface CreditInfo {
  kunnr: string;
  /** KNKK-KLIMK */
  creditLimit: number;
  /** KNKK-SKFOR — open orders + open AR */
  utilized: number;
  /** Computed: creditLimit - utilized */
  available: number;
  /** KNKK-CTLPC — credit block indicator */
  blocked: boolean;
  currency: string;
}

/** Shipping address a customer may pick as ship-to (VBPA partner SH). */
export interface ShipToAddress {
  kunnr: string;
  label: string;
  address: CanonicalAddress;
}
