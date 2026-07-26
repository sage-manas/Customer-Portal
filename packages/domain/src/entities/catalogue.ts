/**
 * Canonical catalogue shapes (docs/03-FUNCTIONAL-SPEC.md Module 2).
 * SAP provenance for each field lives in sap-mapping/catalogue.ts.
 */

export interface Material {
  /** MARA-MATNR */
  material: string;
  /** MAKT-MAKTX */
  description: string;
  /** MARA-MATKL */
  materialGroup: string;
  /** MARA-MEINS */
  uom: string;
  /** MVKE-MINBM — minimum order quantity */
  minimumOrderQty: number;
  /** Portal-managed asset, GOS-linked (not a SAP field). */
  imageUrl?: string;
  specSheetUrl?: string;
}

/** MARD-LABST for one material/plant, plus the freshness the UI must show. */
export interface StockLevel {
  material: string;
  /** MARC-WERKS */
  plant: string;
  quantity: number;
  uom: string;
  /** MARC-WEBAZ — goods receipt processing time, in days. */
  leadTimeDays?: number;
}

/**
 * Customer-specific price from the pricing conditions (VK13 / order
 * simulation). `netPrice` is ex-GST — the portal never computes tax
 * (docs/02 §5).
 */
export interface CustomerPrice {
  material: string;
  kunnr: string;
  quantity: number;
  uom: string;
  /** KONP-KBETR, condition PR00 */
  listPrice: number;
  /** After customer-specific conditions (K007/K005) are applied. */
  netPrice: number;
  discountPercent: number;
  currency: string;
  /** KONH-KNUMH */
  conditionRecord?: string;
  /** KONH-DATAB / DATBI, ISO dates */
  validFrom?: string;
  validTo?: string;
}

export interface MaterialQuery {
  /** Free-text over MATNR / MAKTX. */
  search?: string;
  /** MARA-MATKL */
  materialGroup?: string;
  /** MARC-WERKS */
  plant?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}
