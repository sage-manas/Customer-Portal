/**
 * Frontend-only stand-in for `@cc/service-catalogue`.
 *
 * Reads (browse, product detail, price list, availability) come from the
 * seeded SAP landscape and are faithful. The cart is portal-owned state —
 * a Prisma table in /client — so it lives in the in-memory demo store here.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-catalogue; the cart moves back to the
 * `Cart`/`CartLine` tables and repricing happens against the live adapter.
 */

import {
  stockAvailability,
  totalStock,
  type Cart,
  type CartLine,
  type CartLineIssue,
  type CustomerPrice,
  type Material,
  type MaterialQuery,
  type Page,
  type StockAvailability,
  type StockLevel,
} from "@cc/domain";

import {
  DemoServiceError,
  DEMO_FRESHNESS,
  demoStore,
  demoSyncedAt,
  notFound,
  requireDemoKunnr,
} from "./_demo";

import { isSapError, type FreshnessClass, type SapAdapter } from "../sap-mock";

export class CatalogueError extends DemoServiceError {
  constructor(message: string, code = "catalogue_error", status = 400) {
    super(message, { code, status });
    this.name = "CatalogueError";
  }
}

export function isCatalogueError(error: unknown): error is CatalogueError {
  return error instanceof CatalogueError;
}

export type CatalogueErrorCode = string;
export type CatalogueIssue = { path: string; message: string };

export function toCatalogueError(error: unknown): CatalogueError {
  if (isCatalogueError(error)) return error;
  return new CatalogueError(
    "We couldn't reach the product catalogue just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CatalogueBrowseResult {
  page: Page<Material>;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function browseCatalogue(
  adapter: SapAdapter,
  query: MaterialQuery = {},
): Promise<CatalogueBrowseResult> {
  try {
    const read = await adapter.getMaterials(query);
    return { page: read.data, freshness: DEMO_FRESHNESS, syncedAt: demoSyncedAt() };
  } catch (error) {
    throw toCatalogueError(error);
  }
}

/** The distinct MARA-MATKL values the catalogue contains, for the filter dropdown. */
export async function listMaterialGroups(adapter: SapAdapter): Promise<string[]> {
  try {
    const read = await adapter.getMaterials({});
    return [...new Set(read.data.items.map((material) => material.materialGroup))].sort();
  } catch (error) {
    throw toCatalogueError(error);
  }
}

export interface MaterialSearchHit {
  material: string;
  description: string;
  materialGroup: string;
  uom: string;
}

/** Drops the separators buyers leave out: MAT-10001 typed as "mat10001". */
function normaliseCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesSearch(item: Material, query: string): boolean {
  const q = query.toLowerCase();

  // MATNR: the code is matched anywhere in the number, not just at its
  // start — the same as an SAP match code on `*10001*`.
  const needle = normaliseCode(query);
  if (needle && normaliseCode(item.material).includes(needle)) return true;

  // MAKTX: a hit when any word starts with the query.
  if (item.description.toLowerCase().split(/\s+/).some((word) => word.startsWith(q))) return true;

  // MATKL: same prefix rule as the description.
  return item.materialGroup.toLowerCase().startsWith(q);
}

/**
 * Match-code search over MATNR / MAKTX / MATKL, capped.
 *
 * The rules live here rather than in the browser because they are the query
 * — when this is repointed at the real adapter, `search` becomes an SAP
 * selection and the shape of the response must not change.
 *
 * TODO(BACKEND): push the matching into adapter.getMaterials so SAP does the
 * selection instead of filtering a fetched page.
 */
export async function searchMaterials(
  adapter: SapAdapter,
  term: string,
  limit = 12,
): Promise<MaterialSearchHit[]> {
  const query = term.trim();
  if (!query) return [];

  try {
    const read = await adapter.getMaterials({});
    return read.data.items
      .filter((item) => matchesSearch(item, query))
      .slice(0, limit)
      .map((item) => ({
        material: item.material,
        description: item.description,
        materialGroup: item.materialGroup,
        uom: item.uom,
      }));
  } catch (error) {
    throw toCatalogueError(error);
  }
}

export interface ProductDetail {
  material: Material;
  stock: StockLevel[];
  totalQuantity: number;
  availability: StockAvailability;
  price: CustomerPrice | null;
  priceUnavailableReason?: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getProductDetail(
  adapter: SapAdapter,
  kunnr: string | undefined,
  material: string,
  _quantity?: number,
): Promise<ProductDetail> {
  let materialRead;
  try {
    materialRead = await adapter.getMaterial(material);
  } catch (error) {
    notFoundMaterialOrUnavailable(error, material);
  }

  const stock = await adapter.getStock(material).catch(() => ({ data: [] as StockLevel[] }));
  const quantity = totalStock(stock.data);
  const priced = kunnr
    ? await priceOrNull(adapter, material, kunnr)
    : { price: null, reason: undefined };

  return {
    material: materialRead.data,
    stock: stock.data,
    totalQuantity: quantity,
    availability: stockAvailability(quantity, materialRead.data.minimumOrderQty),
    price: priced.price,
    priceUnavailableReason: priced.reason,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface MaterialAvailability {
  material: string;
  price: CustomerPrice | null;
  quantity: number | null;
  availability: StockAvailability;
  uom: string;
  plant?: string;
  priceUnavailableReason?: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getMaterialAvailability(
  adapter: SapAdapter,
  kunnr: string | undefined,
  material: string,
  options: { plant?: string; quantity?: number; minimumOrderQty?: number } = {},
): Promise<MaterialAvailability> {
  let materialRead;
  try {
    materialRead = await adapter.getMaterial(material);
  } catch (error) {
    notFoundMaterialOrUnavailable(error, material);
  }

  const stock = await adapter
    .getStock(material, options.plant)
    .catch(() => ({ data: [] as StockLevel[] }));
  const quantity = totalStock(stock.data);
  const price = kunnr
    ? await priceOrNull(adapter, material, kunnr, options.quantity)
    : { price: null, reason: undefined };

  return {
    material,
    price: price.price,
    quantity,
    availability: stockAvailability(quantity, materialRead.data.minimumOrderQty),
    uom: materialRead.data.uom,
    plant: options.plant,
    priceUnavailableReason: price.reason,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

/**
 * Batched sibling of `getMaterialAvailability` (REMEDIATION-PLAN §6).
 *
 * `ProductGrid` used to fire one `/availability` request per card — fine at
 * 24 cards, but it couples to the catalogue page size, which §4 just made a
 * real variable. This collapses a page's worth of cards into one round
 * trip while keeping each card's own price/stock read (and its own
 * not-found/unavailable handling) independent, so a bad material in the
 * batch doesn't take the rest of the page down with it.
 */
export async function getMaterialsAvailability(
  adapter: SapAdapter,
  kunnr: string | undefined,
  items: Array<{ material: string; quantity?: number }>,
  plant?: string,
): Promise<Record<string, MaterialAvailability>> {
  const entries = await Promise.all(
    items.map(async ({ material, quantity }) => {
      try {
        const availability = await getMaterialAvailability(adapter, kunnr, material, {
          plant,
          quantity,
        });
        return [material, availability] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, MaterialAvailability] => entry !== null),
  );
}

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
  unavailableReason?: string;
}

export interface PriceList {
  kunnr: string;
  rows: PriceListRow[];
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getPriceList(
  adapter: SapAdapter,
  kunnr: string,
  query: MaterialQuery = {},
): Promise<PriceList> {
  try {
    const materials = await adapter.getMaterials({ limit: 200, ...query });
    const rows: PriceListRow[] = [];
    let currency = "INR";

    for (const material of materials.data.items) {
      const priced = await priceOrNull(adapter, material.material, kunnr);
      const price = priced.price;
      if (price) currency = price.currency;
      rows.push({
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
        unavailableReason: priced.reason,
      });
    }

    return { kunnr, rows, currency, freshness: DEMO_FRESHNESS, syncedAt: demoSyncedAt() };
  } catch (error) {
    throw toCatalogueError(error);
  }
}

/** The plant with the most free stock — the one an order would be sourced from. */
export function bestPlant(levels: readonly StockLevel[]): string | undefined {
  return [...levels].sort((a, b) => b.quantity - a.quantity)[0]?.plant;
}

async function priceOrNull(
  adapter: SapAdapter,
  material: string,
  kunnr: string,
  quantity = 1,
): Promise<{ price: CustomerPrice | null; reason?: string }> {
  try {
    const read = await adapter.getCustomerPrice(kunnr, material, quantity);
    return { price: read.data };
  } catch (error) {
    // No PR00 condition record is a business answer, not an outage — the
    // screens render "On request" from it (docs/05 §7.2).
    return {
      price: null,
      reason: error instanceof Error ? error.message : "No price is on record for this material.",
    };
  }
}

function notFoundMaterial(material: string): CatalogueError {
  return new CatalogueError(`We couldn't find material ${material}.`, "not_found", 404);
}

/**
 * Maps a failed material lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundMaterialOrUnavailable(error: unknown, material: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toCatalogueError(error);
  throw notFoundMaterial(material);
}

// ---------------------------------------------------------------------------
// Cart (portal-owned)
// ---------------------------------------------------------------------------

/** What the demo store holds: the raw lines. Prices are never stored. */
interface StoredCart {
  key: string;
  id: string;
  kunnr: string;
  lines: Array<{
    id: string;
    material: string;
    description: string;
    quantity: number;
    uom: string;
    minimumOrderQty: number;
    addedAt: Date;
  }>;
}

function cartFor(tenantId: string, kunnr: string): StoredCart {
  const store = demoStore();
  const key = `${tenantId}:${kunnr}`;
  const carts = store.carts as StoredCart[];
  let cart = carts.find((row) => row.key === key);
  if (!cart) {
    cart = { key, id: `cart-${carts.length + 1}`, kunnr, lines: [] };
    carts.push(cart);
  }
  return cart;
}

/**
 * Reprices the whole cart on every read and every mutation, exactly as the
 * real service does: the drawer must never show a price the order would not
 * honour, so nothing priced is ever stored (ADR-018's rule).
 */
async function priceCart(adapter: SapAdapter, cart: StoredCart, kunnr: string): Promise<Cart> {
  const lines: CartLine[] = [];
  let priced = true;

  for (const stored of cart.lines) {
    const availability = await getMaterialAvailability(adapter, kunnr, stored.material, {
      quantity: stored.quantity,
    }).catch(() => null);

    if (!availability) priced = false;

    const netPrice = availability?.price?.netPrice ?? null;
    const availableStock = availability?.quantity ?? null;
    const issues: CartLineIssue[] = [];

    if (stored.quantity < stored.minimumOrderQty) {
      issues.push({
        code: "below_moq",
        message: `Minimum order quantity is ${stored.minimumOrderQty} ${stored.uom}.`,
        severity: "blocker",
      });
    }
    if (netPrice === null) {
      issues.push({
        code: "not_priced",
        message:
          availability?.priceUnavailableReason ?? "No price is on record for this material yet.",
        severity: "blocker",
      });
    }
    if (availableStock !== null && availableStock <= 0) {
      issues.push({
        code: "out_of_stock",
        message: "Out of stock — orderable on lead time.",
        severity: "warning",
      });
    } else if (availableStock !== null && availableStock < stored.quantity) {
      issues.push({
        code: "insufficient_stock",
        message: `Only ${availableStock} ${stored.uom} available today.`,
        severity: "warning",
      });
    }

    lines.push({
      id: stored.id,
      material: stored.material,
      description: stored.description,
      quantity: stored.quantity,
      uom: availability?.uom ?? stored.uom,
      minimumOrderQty: stored.minimumOrderQty,
      netPrice,
      lineValue: netPrice === null ? null : round2(netPrice * stored.quantity),
      availableStock,
      plant: availability?.plant,
      issues,
      addedAt: stored.addedAt,
    });
  }

  return {
    id: cart.id,
    kunnr,
    lines,
    netValue: round2(lines.reduce((total, line) => total + (line.lineValue ?? 0), 0)),
    currency: "INR",
    hasBlockingIssues: lines.some((line) =>
      line.issues.some((issue) => issue.severity === "blocker"),
    ),
    priced,
    updatedAt: new Date(),
  };
}

export async function getCart(
  tenantId: string,
  kunnr: string | undefined,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireDemoKunnr(kunnr);
  return priceCart(adapter, cartFor(tenantId, account), account);
}

export async function getCartLineCount(
  tenantId: string,
  kunnr: string | undefined,
): Promise<number> {
  if (!kunnr) return 0;
  return cartFor(tenantId, kunnr).lines.length;
}

export async function addToCart(
  adapter: SapAdapter,
  tenantId: string,
  kunnr: string | undefined,
  input: { material: string; quantity: number },
): Promise<Cart> {
  const account = requireDemoKunnr(kunnr);
  const cart = cartFor(tenantId, account);

  const material = await adapter.getMaterial(input.material).catch(() => null);
  if (!material) throw notFoundMaterial(input.material);
  if (input.quantity < material.data.minimumOrderQty) {
    throw new CatalogueError(
      `The minimum order quantity for ${input.material} is ${material.data.minimumOrderQty} ${material.data.uom}.`,
      "below_moq",
      422,
    );
  }

  const existing = cart.lines.find((line) => line.material === input.material);
  if (existing) existing.quantity += input.quantity;
  else {
    cart.lines.push({
      id: `line-${cart.lines.length + 1}-${input.material}`,
      material: input.material,
      description: material.data.description,
      quantity: input.quantity,
      uom: material.data.uom,
      minimumOrderQty: material.data.minimumOrderQty,
      addedAt: new Date(),
    });
  }

  return priceCart(adapter, cart, account);
}

export async function updateCartLine(
  adapter: SapAdapter,
  tenantId: string,
  kunnr: string | undefined,
  lineId: string,
  quantity: number,
): Promise<Cart> {
  const account = requireDemoKunnr(kunnr);
  const cart = cartFor(tenantId, account);
  const line = cart.lines.find((row) => row.id === lineId);
  if (!line) throw notFound("Cart line");
  line.quantity = quantity;
  return priceCart(adapter, cart, account);
}

export async function removeCartLine(
  adapter: SapAdapter,
  tenantId: string,
  kunnr: string | undefined,
  lineId: string,
): Promise<Cart> {
  const account = requireDemoKunnr(kunnr);
  const cart = cartFor(tenantId, account);
  cart.lines = cart.lines.filter((row) => row.id !== lineId);
  return priceCart(adapter, cart, account);
}

export async function clearCart(
  adapter: SapAdapter,
  tenantId: string,
  kunnr: string | undefined,
): Promise<Cart> {
  const account = requireDemoKunnr(kunnr);
  const cart = cartFor(tenantId, account);
  cart.lines = [];
  return priceCart(adapter, cart, account);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
