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
 * A partial change to an existing customer master (XD02 / BP PATCH).
 *
 * Everything is optional and the tax identifiers are absent entirely: what
 * may be changed from the portal is the tenant-facing registry
 * `CUSTOMER_EDITABLE_FIELDS` (entities/customer-account.ts), and this type is
 * the adapter-side statement of the same boundary — a driver cannot be asked
 * to write a GSTIN because there is nowhere to put one.
 */
export interface CustomerPatch {
  /** KNA1-NAME2 */
  tradeName?: string;
  address?: CanonicalAddress;
  contact?: CanonicalContact;
}

/** Result of a change-customer write. */
export interface CustomerUpdateResult {
  kunnr: string;
  /** Echo of what SAP stored after applying the patch, truncation included. */
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

/**
 * A rebate agreement and what has accrued under it (KONA — docs/03 Screen
 * 9.2). Created in VBO1 and settled in VBO2, so the portal only ever reads it:
 * the accrual is SAP's arithmetic over the billing documents, and a portal
 * that recomputed it would eventually promise a customer money the tenant's
 * own settlement run disagrees with.
 */
export interface RebateAgreement {
  /** KONA-KNUMA */
  agreementNumber: string;
  kunnr: string;
  /** KONA-BOART — the agreement type, as the tenant configured it. */
  agreementType?: string;
  description: string;
  /** KONA-BODAT / BODBE, ISO dates. */
  validFrom: string;
  validTo: string;
  /** KONA-KAWRT — accrued to date, not yet settled. */
  accruedAmount: number;
  /** KONA-BOSTA — B open, C released for settlement, D settled. */
  settlementStatus?: string;
  currency: string;
}

/**
 * VB(7 — settling a rebate agreement, which posts the credit memo request
 * SAP then bills as a credit note (doc 09 §3.4, the AP desk's queue).
 */
export interface RebateSettlementInput {
  agreementNumber: string;
  /** Idempotency key derived from the agreement, never freshly generated. */
  reference: string;
  /** Carried onto the settlement document, so SAP records who authorised it. */
  initiatedBy?: string;
  note?: string;
}

export interface RebateSettlementResult {
  agreementNumber: string;
  /** The credit memo request VB(7 creates (VBELN of the B1/B3 document). */
  creditMemoRequest: string;
  settledAmount: number;
  currency: string;
  /** KONA-BOSTA as it stands after the settlement run. */
  settlementStatus: string;
}

/** Shipping address a customer may pick as ship-to (VBPA partner SH). */
export interface ShipToAddress {
  kunnr: string;
  label: string;
  address: CanonicalAddress;
}
