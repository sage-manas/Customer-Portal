import { isSapError, type SapAdapter } from "@cc/adapter-sap";
import { db, getTenantId, runWithTenant } from "@cc/db";
import type { Cart, CartLine, CartLineInput, CartLineIssue, Material } from "@cc/domain";
import { cartLineWriteSchema, totalStock } from "@cc/domain";

import { bestPlant, toCatalogueError } from "./catalogue-service";
import { CatalogueError } from "./errors";

/**
 * Cart (docs/05-UI-UX-DESIGN.md §7.2 — the persistent drawer).
 *
 * The cart is the one thing in this module SAP does not own, so it is the
 * one thing that is stored. What is *not* stored is price and stock: those
 * are per-customer SAP reads that go stale between page loads, so every
 * read of the cart reprices through the adapter. A cart that showed the
 * price it was added at would quietly mis-state the order value at checkout.
 *
 * The cart belongs to a KUNNR, not a user: colleagues on the same sold-to
 * account share one basket. Tenant scoping is structural as everywhere else
 * — every query runs inside `runWithTenant`, so another tenant's cart is not
 * found rather than forbidden (CLAUDE.md rule 5).
 *
 * When SAP is unreachable the cart still renders, unpriced and flagged
 * `priced: false`, rather than 503-ing — doc 05 P7: the portal never
 * hard-fails because SAP is down.
 */

interface CartLineRow {
  id: string;
  material: string;
  quantity: unknown;
  addedAt: Date;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Prisma returns Decimal; the domain speaks numbers. */
const toNumber = (value: unknown): number => Number(value);

function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new CatalogueError("no_account");
  return kunnr;
}

async function findOrCreateCart(kunnr: string): Promise<{ id: string; updatedAt: Date }> {
  const tenantId = getTenantId();
  return db.cart.upsert({
    where: { tenantId_customerKunnr: { tenantId, customerKunnr: kunnr } },
    create: { tenantId, customerKunnr: kunnr },
    update: {},
    select: { id: true, updatedAt: true },
  });
}

function issuesFor(
  material: Material | null,
  quantity: number,
  stock: number | null,
  priced: boolean,
): CartLineIssue[] {
  const issues: CartLineIssue[] = [];
  const moq = material?.minimumOrderQty ?? 0;

  if (moq > 0 && quantity < moq) {
    issues.push({
      code: "below_moq",
      // SAP would reject this at VA01 with V1/337; catching it here means the
      // customer finds out in the drawer, not after pressing Submit.
      message: `Minimum order quantity is ${moq} ${material?.uom ?? ""}`.trim(),
      severity: "blocker",
    });
  }

  if (stock !== null) {
    if (stock <= 0) {
      issues.push({
        code: "out_of_stock",
        message: "Out of stock — this line will be confirmed on lead time.",
        severity: "warning",
      });
    } else if (quantity > stock) {
      issues.push({
        code: "insufficient_stock",
        message:
          `Only ${stock} ${material?.uom ?? ""} available now — the rest follows on lead time.`.trim(),
        severity: "warning",
      });
    }
  }

  if (!priced) {
    issues.push({
      code: "not_priced",
      message: "We can't price this online — request a quote and sales will price it.",
      severity: "blocker",
    });
  }

  return issues;
}

/**
 * Reprices stored lines against SAP. Returns `priced: false` (and leaves
 * every price null) when SAP is unreachable, so the drawer can say so
 * instead of the page failing.
 */
async function toCart(
  kunnr: string,
  cartId: string,
  rows: CartLineRow[],
  updatedAt: Date,
  adapter: SapAdapter,
): Promise<Cart> {
  if (rows.length === 0) {
    return {
      id: cartId,
      kunnr,
      lines: [],
      netValue: 0,
      currency: "INR",
      hasBlockingIssues: false,
      priced: true,
      updatedAt,
    };
  }

  const priced = await Promise.all(
    rows.map(async (row) => {
      const quantity = toNumber(row.quantity);
      try {
        const [materialRead, stockRead] = await Promise.all([
          adapter.getMaterial(row.material),
          adapter.getStock(row.material),
        ]);
        const material = materialRead.data;
        const stock = totalStock(stockRead.data);

        let netPrice: number | null = null;
        try {
          const priceRead = await adapter.getCustomerPrice(kunnr, row.material, quantity);
          netPrice = priceRead.data.netPrice;
        } catch (error) {
          // No condition record: browsable and quotable, just not orderable.
          if (!isSapError(error) || error.kind !== "validation") throw error;
        }

        const line: CartLine = {
          id: row.id,
          material: row.material,
          description: material.description,
          quantity,
          uom: material.uom,
          minimumOrderQty: material.minimumOrderQty,
          netPrice,
          lineValue: netPrice === null ? null : round2(netPrice * quantity),
          availableStock: stock,
          plant: bestPlant(stockRead.data)?.plant,
          issues: issuesFor(material, quantity, stock, netPrice !== null),
          addedAt: row.addedAt,
        };
        return { line, priced: true };
      } catch (error) {
        if (
          isSapError(error) &&
          (error.kind === "unavailable" || error.kind === "not_implemented")
        ) {
          const line: CartLine = {
            id: row.id,
            material: row.material,
            description: row.material,
            quantity,
            uom: "",
            minimumOrderQty: 0,
            netPrice: null,
            lineValue: null,
            availableStock: null,
            issues: [],
            addedAt: row.addedAt,
          };
          return { line, priced: false };
        }
        throw toCatalogueError(error, "material", row.material);
      }
    }),
  );

  const allPriced = priced.every((entry) => entry.priced);
  const lines = priced.map((entry) => entry.line);

  return {
    id: cartId,
    kunnr,
    lines,
    netValue: round2(lines.reduce((sum, line) => sum + (line.lineValue ?? 0), 0)),
    currency: "INR",
    // An unpriced cart is not a blocked cart — the customer is told prices
    // are unavailable, and the order CTA is gated on `priced` separately.
    hasBlockingIssues: lines.some((line) => line.issues.some((i) => i.severity === "blocker")),
    priced: allPriced,
    updatedAt,
  };
}

async function loadCart(kunnr: string, adapter: SapAdapter): Promise<Cart> {
  const cart = await findOrCreateCart(kunnr);
  const rows = await db.cartLine.findMany({
    where: { cartId: cart.id },
    orderBy: { addedAt: "asc" },
    select: { id: true, material: true, quantity: true, addedAt: true },
  });
  return toCart(kunnr, cart.id, rows, cart.updatedAt, adapter);
}

export async function getCart(
  tenantId: string,
  kunnr: string | undefined,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireKunnr(kunnr);
  return runWithTenant(tenantId, () => loadCart(account, adapter));
}

/**
 * Adds a material, or increases its quantity if it is already in the cart —
 * hence the unique constraint on (tenant, cart, material). The material is
 * verified against SAP first: a cart line for a material that doesn't exist
 * would only fail later, at order creation, with a worse message.
 */
export async function addToCart(
  tenantId: string,
  kunnr: string | undefined,
  input: CartLineInput,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireKunnr(kunnr);
  const parsed = cartLineWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw new CatalogueError("invalid", {
      issues: parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? "material"),
        message: issue.message,
      })),
    });
  }
  const { material, quantity } = parsed.data;

  await adapter.getMaterial(material).catch((error: unknown) => {
    throw toCatalogueError(error, "material", material);
  });

  return runWithTenant(tenantId, async () => {
    const cart = await findOrCreateCart(account);
    const tenantIdBound = getTenantId();
    const existing = await db.cartLine.findUnique({
      where: { tenantId_cartId_material: { tenantId: tenantIdBound, cartId: cart.id, material } },
      select: { id: true, quantity: true },
    });

    if (existing) {
      await db.cartLine.update({
        where: { id: existing.id },
        data: { quantity: toNumber(existing.quantity) + quantity },
      });
    } else {
      await db.cartLine.create({
        data: { tenantId: tenantIdBound, cartId: cart.id, material, quantity },
      });
    }
    await db.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });

    return loadCart(account, adapter);
  });
}

export async function updateCartLine(
  tenantId: string,
  kunnr: string | undefined,
  lineId: string,
  quantity: number,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireKunnr(kunnr);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new CatalogueError("invalid", {
      issues: [{ field: "quantity", message: "Quantity must be greater than zero" }],
    });
  }

  return runWithTenant(tenantId, async () => {
    const cart = await findOrCreateCart(account);
    // Scoped by cartId as well as id: a line id from another account's cart
    // within the same tenant must be as unfindable as another tenant's.
    const updated = await db.cartLine.updateMany({
      where: { id: lineId, cartId: cart.id },
      data: { quantity },
    });
    if (updated.count === 0) throw new CatalogueError("not_found");

    return loadCart(account, adapter);
  });
}

export async function removeCartLine(
  tenantId: string,
  kunnr: string | undefined,
  lineId: string,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireKunnr(kunnr);

  return runWithTenant(tenantId, async () => {
    const cart = await findOrCreateCart(account);
    const deleted = await db.cartLine.deleteMany({ where: { id: lineId, cartId: cart.id } });
    if (deleted.count === 0) throw new CatalogueError("not_found");

    return loadCart(account, adapter);
  });
}

export async function clearCart(
  tenantId: string,
  kunnr: string | undefined,
  adapter: SapAdapter,
): Promise<Cart> {
  const account = requireKunnr(kunnr);

  return runWithTenant(tenantId, async () => {
    const cart = await findOrCreateCart(account);
    await db.cartLine.deleteMany({ where: { cartId: cart.id } });
    return loadCart(account, adapter);
  });
}

/**
 * Line count for the top-bar cart badge. Kept separate from `getCart` so
 * the shell doesn't pay for a full repricing on every page render.
 */
export async function getCartLineCount(
  tenantId: string,
  kunnr: string | undefined,
): Promise<number> {
  if (!kunnr) return 0;
  return runWithTenant(tenantId, async () => {
    const tenantIdBound = getTenantId();
    const cart = await db.cart.findUnique({
      where: { tenantId_customerKunnr: { tenantId: tenantIdBound, customerKunnr: kunnr } },
      select: { id: true },
    });
    if (!cart) return 0;
    return db.cartLine.count({ where: { cartId: cart.id } });
  });
}
