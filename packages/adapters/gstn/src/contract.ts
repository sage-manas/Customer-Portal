/**
 * GSTN taxpayer verification (docs/03-FUNCTIONAL-SPEC.md Screen 1.2,
 * docs/05-UI-UX-DESIGN.md §7.1 — "live GSTN API verify: spinner → verified
 * tick with legal name echo → mismatch warning").
 *
 * Mock-first, like every external system: the `mock` driver is built first
 * and is what every phase before production runs against. Service code
 * depends on this interface and resolves a driver per tenant through
 * `createGstnAdapter` — it never imports a driver.
 */

export type GstnDriverName = "mock" | "api";

/** GSTN taxpayer status, as the public search API reports it. */
export type GstnTaxpayerStatus = "Active" | "Cancelled" | "Suspended" | "Provisional";

export interface GstnTaxpayer {
  gstin: string;
  /** Legal name of business — echoed to the applicant to confirm. */
  legalName: string;
  tradeName?: string;
  /** First two digits of the GSTIN; must match KNA1-REGIO (docs/03). */
  stateCode: string;
  status: GstnTaxpayerStatus;
  /** Constitution of business, e.g. "Private Limited Company". */
  constitution?: string;
  /** Taxpayer type mapped to J_1IGSTIN_REGTP: 01 Regular / 02 Composition / 04 SEZ. */
  registrationType?: string;
  /** ISO date of registration. */
  registeredOn?: string;
  principalPlaceOfBusiness?: string;
  /** When this answer was obtained — persisted as verification evidence. */
  checkedAt: string;
}

export interface GstnHealth {
  reachable: boolean;
  driver: GstnDriverName;
  checkedAt: string;
}

export interface GstnAdapter {
  readonly driver: GstnDriverName;
  health(): Promise<GstnHealth>;
  /**
   * Looks up a GSTIN. Throws `GstnError` — `invalid_format` before any call
   * is made, `not_found` for an unregistered number, `unavailable` when
   * GSTN itself is down (the wizard degrades to "we'll verify during
   * review" rather than blocking the applicant, docs/05 P7).
   */
  verifyGstin(gstin: string): Promise<GstnTaxpayer>;
}
