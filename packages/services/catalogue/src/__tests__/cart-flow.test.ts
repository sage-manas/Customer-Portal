import { randomUUID } from "node:crypto";

import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addToCart,
  clearCart,
  getCart,
  getCartLineCount,
  removeCartLine,
  updateCartLine,
} from "../cart-service";

/**
 * The cart, end to end against a real database and the mock SAP driver:
 * stored lines -> repricing -> MOQ/stock issues -> tenant isolation.
 * Requires Postgres (see the package README).
 */

// Sharma Industrial Supplies — the seeded customer with material-specific
// discounts, so repricing is visibly customer-specific.
const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";

function sap(options = {}) {
  return new MockSapAdapter(options);
}

describe("cart flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `cart-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `cart-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.cartLine.deleteMany();
        await db.cart.deleteMany();
      });
    }
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.cartLine.deleteMany();
        await db.cart.deleteMany();
      });
    }
  });

  it("starts empty and prices a line on add", async () => {
    const empty = await getCart(tenantA.id, KUNNR, sap());
    expect(empty.lines).toEqual([]);
    expect(empty.netValue).toBe(0);

    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());

    expect(cart.lines).toHaveLength(1);
    const [line] = cart.lines;
    expect(line!.description).toContain("Hydraulic Pump");
    expect(line!.uom).toBe("EA");
    expect(line!.netPrice).toBeGreaterThan(0);
    expect(line!.lineValue).toBe(line!.netPrice! * 2);
    expect(cart.netValue).toBe(line!.lineValue);
    expect(cart.hasBlockingIssues).toBe(false);
  });

  it("adding the same material again increases the quantity rather than duplicating it", async () => {
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());
    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 3 }, sap());

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.quantity).toBe(5);
  });

  it("reprices on every read instead of trusting a stored price", async () => {
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 1 }, sap());

    const asSharma = await getCart(tenantA.id, KUNNR, sap());
    await addToCart(tenantA.id, OTHER_KUNNR, { material: "MAT-10001", quantity: 1 }, sap());
    const asOther = await getCart(tenantA.id, OTHER_KUNNR, sap());

    // Same material, same tenant, different sold-to: different net price.
    expect(asSharma.lines[0]!.netPrice).not.toBe(asOther.lines[0]!.netPrice);
  });

  it("flags a below-MOQ quantity as a blocker before SAP ever sees it", async () => {
    // MAT-10003 has MVKE-MINBM 5.
    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10003", quantity: 2 }, sap());

    const [line] = cart.lines;
    expect(line!.issues.map((i) => i.code)).toContain("below_moq");
    expect(cart.hasBlockingIssues).toBe(true);
  });

  it("flags short stock as a warning, not a blocker — lead time is a date, not a refusal", async () => {
    // MAT-10002 has 8 EA at plant 1000.
    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10002", quantity: 50 }, sap());

    const [line] = cart.lines;
    expect(line!.issues.map((i) => i.code)).toContain("insufficient_stock");
    expect(line!.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(cart.hasBlockingIssues).toBe(false);
  });

  it("updates and removes lines, and rejects a line id from another account's cart", async () => {
    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());
    const lineId = cart.lines[0]!.id;

    const updated = await updateCartLine(tenantA.id, KUNNR, lineId, 7, sap());
    expect(updated.lines[0]!.quantity).toBe(7);

    // Same tenant, different sold-to: not found, never "forbidden".
    await expect(updateCartLine(tenantA.id, OTHER_KUNNR, lineId, 1, sap())).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });

    const emptied = await removeCartLine(tenantA.id, KUNNR, lineId, sap());
    expect(emptied.lines).toEqual([]);
  });

  it("rejects a non-positive quantity", async () => {
    const cart = await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 1 }, sap());
    await expect(
      updateCartLine(tenantA.id, KUNNR, cart.lines[0]!.id, 0, sap()),
    ).rejects.toMatchObject({ code: "invalid", status: 422 });
  });

  it("404s an unknown material instead of storing a line SAP would reject later", async () => {
    await expect(
      addToCart(tenantA.id, KUNNR, { material: "MAT-NOPE", quantity: 1 }, sap()),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("renders unpriced rather than failing when SAP is down (docs/05 P7)", async () => {
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());

    const cart = await getCart(tenantA.id, KUNNR, sap({ unavailable: true }));

    expect(cart.lines).toHaveLength(1);
    expect(cart.priced).toBe(false);
    expect(cart.lines[0]!.netPrice).toBeNull();
    expect(cart.netValue).toBe(0);
  });

  it("keeps carts of the same KUNNR in different tenants apart", async () => {
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());

    const inTenantB = await getCart(tenantB.id, KUNNR, sap());
    expect(inTenantB.lines).toEqual([]);
    expect(await getCartLineCount(tenantA.id, KUNNR)).toBe(1);
    expect(await getCartLineCount(tenantB.id, KUNNR)).toBe(0);
  });

  it("clears the cart", async () => {
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10001", quantity: 2 }, sap());
    await addToCart(tenantA.id, KUNNR, { material: "MAT-10003", quantity: 5 }, sap());

    const cleared = await clearCart(tenantA.id, KUNNR, sap());
    expect(cleared.lines).toEqual([]);
    expect(await getCartLineCount(tenantA.id, KUNNR)).toBe(0);
  });

  it("refuses to work without a sold-to account", async () => {
    await expect(getCart(tenantA.id, undefined, sap())).rejects.toMatchObject({
      code: "no_account",
      status: 409,
    });
  });
});
