import type { GstnAdapter, GstnHealth, GstnTaxpayer } from "../contract";
import { GstnError } from "../errors";

/**
 * Real GSTN taxpayer-search driver — skeleton only, wired up in Phase 7
 * alongside the ECC/S4 SAP drivers.
 *
 * Every method throws `not_implemented` rather than falling back to the
 * mock, for the same reason `EccSapAdapter` does (docs/DECISIONS.md
 * ADR-006): a fabricated "GSTIN verified" tick is a compliance claim, and
 * showing one for a registration nobody checked is worse than an error.
 */

export interface GstnApiConfig {
  baseUrl: string;
  /** Reference to the per-tenant encrypted API credentials (docs/02 §9). */
  credentialsRef: string;
}

export class ApiGstnAdapter implements GstnAdapter {
  readonly driver = "api" as const;

  constructor(private readonly config: GstnApiConfig) {}

  async health(): Promise<GstnHealth> {
    return { reachable: false, driver: this.driver, checkedAt: new Date().toISOString() };
  }

  async verifyGstin(_gstin: string): Promise<GstnTaxpayer> {
    throw new GstnError("GSTIN verification is not available for this tenant yet.", {
      kind: "not_implemented",
      upstreamMessage: `api driver not implemented (endpoint ${this.config.baseUrl})`,
    });
  }
}
