/** SAP landscape a tenant's SapAdapter driver targets (docs/02 §4.4). */
export type SapDriverKind = "mock" | "ecc" | "s4";

/**
 * GSTN verification driver (docs/03 Screen 1.2). `api` is the real GSTN
 * taxpayer-search integration; `mock` is the seeded simulation every
 * pre-production tenant runs on.
 */
export type GstnDriverKind = "mock" | "api";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  customDomain?: string;
  sapDriver: SapDriverKind;
  gstnDriver: GstnDriverKind;
  moduleToggles: Record<string, boolean>;
}
