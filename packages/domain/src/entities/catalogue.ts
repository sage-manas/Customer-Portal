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

/**
 * The three states the stock chip renders (docs/05 §7.2: "In stock n / Low /
 * Out"). Classifying here rather than in the component means the service,
 * the chip and the cart's stock warning can never disagree about what "low"
 * means.
 */
export type StockAvailability = "in_stock" | "low" | "out_of_stock" | "unknown";

/**
 * "Low" is expressed relative to the material's minimum order quantity, not
 * as a flat number: 40 units is plenty of a pump ordered one at a time and
 * nearly nothing of a pipe ordered 50 metres at a time.
 */
export const LOW_STOCK_MOQ_MULTIPLE = 3;

export function stockAvailability(
  quantity: number | null | undefined,
  minimumOrderQty = 1,
): StockAvailability {
  if (quantity === null || quantity === undefined) return "unknown";
  if (quantity <= 0) return "out_of_stock";
  const moq = minimumOrderQty > 0 ? minimumOrderQty : 1;
  return quantity < moq * LOW_STOCK_MOQ_MULTIPLE ? "low" : "in_stock";
}

/** Total free stock across the plants a read returned. */
export function totalStock(levels: readonly StockLevel[]): number {
  return levels.reduce((sum, level) => sum + level.quantity, 0);
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
