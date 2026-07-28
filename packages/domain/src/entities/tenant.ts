/** SAP landscape a tenant's SapAdapter driver targets (docs/02 §4.4). */
export type SapDriverKind = "mock" | "ecc" | "s4";

/**
 * GSTN verification driver (docs/03 Screen 1.2). `api` is the real GSTN
 * taxpayer-search integration; `mock` is the seeded simulation every
 * pre-production tenant runs on.
 */
export type GstnDriverKind = "mock" | "api";

/**
 * Payment gateway driver (docs/03 Screen 7.2, docs/02 §6). `razorpay` is the
 * first real integration; `mock` is the seeded simulation every
 * pre-production tenant runs on.
 */
export type PaymentGatewayKind = "mock" | "razorpay";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  customDomain?: string;
  sapDriver: SapDriverKind;
  gstnDriver: GstnDriverKind;
  paymentGateway: PaymentGatewayKind;
  moduleToggles: Record<string, boolean>;
}
