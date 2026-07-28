import {
  earliestSyncedAt,
  isSapError,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type {
  CustomerPrice,
  Material,
  MaterialQuery,
  Page,
  StockAvailability,
  StockLevel,
} from "@cc/domain";
import { stockAvailability, totalStock } from "@cc/domain";

import { CatalogueError } from "./errors";

/**
 * Product catalogue reads (docs/03 Module 2, docs/05 §7.2).
 *
 * Everything here is SAP master data, so nothing is stored: the service is
 * a composition layer over `SapAdapter` that shapes reads for the screens
 * and carries their freshness with them (ADR-007). The cart, which *is*
 * portal-owned, lives in cart-service.ts.
 *
 * Browse and pricing are deliberately separate calls. Doc 05 §7.2 requires
 * price and stock to load lazily per card with skeletons, because both are
 * per-customer SAP calls — a browse that priced 25 cards inline would make
 * the grid as slow as its slowest condition record.
 */

export interface CatalogueBrowseResult {
  page: Page<Material>;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** What one card fills in once its lazy price/stock read returns. */
export interface MaterialAvailability {
  material: string;
  price: CustomerPrice | null;
  /** Total free stock across plants (or the requested plant only). */
  quantity: number | null;
  availability: StockAvailability;
  uom: string;
  plant?: string;
  /** Set when SAP could not price the material (no PR00 condition record). */
  priceUnavailableReason?: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface ProductDetail {
  material: Material;
  /** Plant-wise stock table (docs/05 §7.2 product detail). */
  stock: StockLevel[];
  totalQuantity: number;
  availability: StockAvailability;
  price: CustomerPrice | null;
  priceUnavailableReason?: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** One row of the customer-specific price list (docs/03 Screen 2.2). */
export interface PriceListRow {
  material: string;
  description: string;
  uom: string;
  minimumOrderQty: number;
  listPrice: number | null;
  discountPercent: number | null;
  netPrice: number | null;
  conditionRecord?: string;
  validFrom?: string;
  validTo?: string;
  /** Set when the material has no valid condition record — shown as "On request". */
  unavailableReason?: string;
}

export interface PriceList {
  kunnr: string;
  rows: PriceListRow[];
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** The quantity a price is quoted for when the customer hasn't chosen one. */
const DEFAULT_PRICE_QUANTITY = 1;

/**
 * Translates a SAP error into the customer-facing catalogue error. A
 * missing condition record is *not* an error at this level — see
 * `priceOrNull` — so only genuine failures reach here.
 */
export function toCatalogueError(error: unknown, what: string, id?: string): CatalogueError {
  if (!isSapError(error)) {
    return new CatalogueError("upstream_unavailable", { cause: error });
  }
  switch (error.kind) {
    case "not_found":
      return new CatalogueError("not_found", {
        message: `We couldn't find ${what}${id ? ` ${id}` : ""}.`,
        cause: error,
      });
    case "validation":
      return new CatalogueError("invalid", {
        issues: error.field ? [{ field: error.field, message: error.message }] : [],
        upstreamMessage: error.sapMessage,
        cause: error,
      });
    case "unavailable":
    case "not_implemented":
      return new CatalogueError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
    default:
      return new CatalogueError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

/**
 * A material with no PR00 condition record is a real, browsable product
 * that simply can't be priced online — doc 03 Screen 2.1 pairs every card
 * with "Request Quote" for exactly this case. So a `validation` error from
 * pricing degrades to `null` and a reason, while an outage still throws.
 */
async function priceOrNull(
  adapter: SapAdapter,
  kunnr: string,
  material: string,
  quantity: number,
): Promise<{
  price: CustomerPrice | null;
  reason?: string;
  read: { freshness: FreshnessClass; syncedAt: string };
}> {
  try {
    const read = await adapter.getCustomerPrice(kunnr, material, quantity);
    return { price: read.data, read };
  } catch (error) {
    if (isSapError(error) && error.kind === "validation") {
      return {
        price: null,
        reason: "No price is published for this item — request a quote and sales will price it.",
        read: { freshness: "live", syncedAt: new Date().toISOString() },
      };
    }
    throw toCatalogueError(error, "a price for material", material);
  }
}

export async function browseCatalogue(
  adapter: SapAdapter,
  query: MaterialQuery = {},
): Promise<CatalogueBrowseResult> {
  try {
    const read = await adapter.getMaterials(query);
    return { page: read.data, freshness: read.freshness, syncedAt: read.syncedAt };
  } catch (error) {
    throw toCatalogueError(error, "the catalogue");
  }
}

/**
 * The lazy per-card read: customer price + stock for one material. Called
 * once per visible card, so it fails soft on pricing and hard on nothing
 * else — a card that can't price still renders with "Request quote".
 */
export async function getMaterialAvailability(
  adapter: SapAdapter,
  kunnr: string,
  material: string,
  options: { quantity?: number; plant?: string; minimumOrderQty?: number } = {},
): Promise<MaterialAvailability> {
  const quantity = options.quantity ?? DEFAULT_PRICE_QUANTITY;

  const [stockRead, priced] = await Promise.all([
    adapter.getStock(material, options.plant).catch((error: unknown) => {
      throw toCatalogueError(error, "material", material);
    }),
    priceOrNull(adapter, kunnr, material, quantity),
  ]);

  const levels = stockRead.data;
  const free = totalStock(levels);
  const moq = options.minimumOrderQty ?? priced.price?.quantity ?? 1;

  return {
    material,
    price: priced.price,
    priceUnavailableReason: priced.reason,
    quantity: free,
    availability: stockAvailability(free, moq),
    uom: levels[0]?.uom ?? priced.price?.uom ?? "",
    plant: options.plant ?? bestPlant(levels)?.plant,
    freshness: leastFresh([stockRead, priced.read]),
    syncedAt: earliestSyncedAt([stockRead, priced.read]),
  };
}

export async function getProductDetail(
  adapter: SapAdapter,
  kunnr: string,
  material: string,
  quantity?: number,
): Promise<ProductDetail> {
  const materialRead = await adapter.getMaterial(material).catch((error: unknown) => {
    throw toCatalogueError(error, "material", material);
  });
  const record = materialRead.data;

  const [stockRead, priced] = await Promise.all([
    adapter.getStock(material).catch((error: unknown) => {
      throw toCatalogueError(error, "material", material);
    }),
    priceOrNull(adapter, kunnr, material, quantity ?? record.minimumOrderQty),
  ]);

  const free = totalStock(stockRead.data);

  return {
    material: record,
    // Highest stock first: that's the plant SAP's own plant determination
    // would pick, so the table's first row is the one that matters.
    stock: [...stockRead.data].sort((a, b) => b.quantity - a.quantity),
    totalQuantity: free,
    availability: stockAvailability(free, record.minimumOrderQty),
    price: priced.price,
    priceUnavailableReason: priced.reason,
    freshness: leastFresh([materialRead, stockRead, priced.read]),
    syncedAt: earliestSyncedAt([materialRead, stockRead, priced.read]),
  };
}

/**
 * Customer-specific price list (docs/03 Screen 2.2): every catalogue
 * material priced for this customer, with the condition record and its
 * validity. Unpriced materials stay in the list marked "on request" rather
 * than vanishing — a gap in a price list reads as a missing product.
 */
export async function getPriceList(
  adapter: SapAdapter,
  kunnr: string,
  query: MaterialQuery = {},
): Promise<PriceList> {
  const materials = await browseCatalogue(adapter, query);

  const priced = await Promise.all(
    materials.page.items.map(async (material) => {
      const result = await priceOrNull(adapter, kunnr, material.material, material.minimumOrderQty);
      return { material, ...result };
    }),
  );

  const rows: PriceListRow[] = priced.map(({ material, price, reason }) => ({
    material: material.material,
    description: material.description,
    uom: material.uom,
    minimumOrderQty: material.minimumOrderQty,
    listPrice: price?.listPrice ?? null,
    discountPercent: price?.discountPercent ?? null,
    netPrice: price?.netPrice ?? null,
    conditionRecord: price?.conditionRecord,
    validFrom: price?.validFrom,
    validTo: price?.validTo,
    unavailableReason: reason,
  }));

  const reads = [
    { freshness: materials.freshness, syncedAt: materials.syncedAt },
    ...priced.map((p) => p.read),
  ];

  return {
    kunnr,
    rows,
    currency: priced.find((p) => p.price)?.price?.currency ?? "INR",
    freshness: leastFresh(reads),
    syncedAt: earliestSyncedAt(reads),
  };
}

/** The plant SAP's plant determination would pick: the one holding most stock. */
export function bestPlant(levels: readonly StockLevel[]): StockLevel | undefined {
  return [...levels].sort((a, b) => b.quantity - a.quantity)[0];
}
