/** SAP landscape a tenant's SapAdapter driver targets (docs/02 §4.4). */
export type SapDriverKind = "mock" | "ecc" | "s4";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  customDomain?: string;
  sapDriver: SapDriverKind;
  moduleToggles: Record<string, boolean>;
}
