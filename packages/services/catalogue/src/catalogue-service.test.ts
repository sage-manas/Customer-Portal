import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import {
  browseCatalogue,
  getMaterialAvailability,
  getPriceList,
  getProductDetail,
} from "./catalogue-service";
import { isCatalogueError } from "./errors";

/**
 * Catalogue reads against the seeded mock landscape. The seed deliberately
 * contains an out-of-stock material (MAT-10004) and a low-stock one
 * (MAT-10002), so the interesting states are exercised without stubbing.
 */

const KUNNR = "0010001001";

function adapter(options = {}) {
  return new MockSapAdapter(options);
}

describe("browseCatalogue", () => {
  it("returns the material page with the read's own freshness", async () => {
    const result = await browseCatalogue(adapter());

    expect(result.page.items.length).toBeGreaterThan(0);
    expect(result.page.total).toBe(result.page.items.length);
    expect(result.freshness).toBe("live");
    expect(result.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("filters by material group and free-text search", async () => {
    const byGroup = await browseCatalogue(adapter(), { materialGroup: "PUMPS" });
    expect(byGroup.page.items.every((m) => m.materialGroup === "PUMPS")).toBe(true);

    const bySearch = await browseCatalogue(adapter(), { search: "gasket" });
    expect(bySearch.page.items.length).toBeGreaterThan(0);
    expect(bySearch.page.items.every((m) => /gasket/i.test(m.description))).toBe(true);
  });

  it("paginates without losing the unpaged total", async () => {
    const all = await browseCatalogue(adapter());
    const firstPage = await browseCatalogue(adapter(), { limit: 4, offset: 0 });

    expect(firstPage.page.items).toHaveLength(4);
    expect(firstPage.page.total).toBe(all.page.total);
  });

  it("translates a SAP outage into a retryable catalogue error, not a raw SapError", async () => {
    await expect(browseCatalogue(adapter({ unavailable: true }))).rejects.toMatchObject({
      name: "CatalogueError",
      code: "upstream_unavailable",
      status: 503,
    });
  });
});

describe("getMaterialAvailability", () => {
  it("prices per customer and classifies stock", async () => {
    const result = await getMaterialAvailability(adapter(), KUNNR, "MAT-10001");

    expect(result.price?.netPrice).toBeGreaterThan(0);
    expect(result.price?.netPrice).toBeLessThanOrEqual(result.price!.listPrice);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.availability).toBe("in_stock");
  });

  it("reports out_of_stock rather than hiding the material", async () => {
    const result = await getMaterialAvailability(adapter(), KUNNR, "MAT-10004");

    expect(result.quantity).toBe(0);
    expect(result.availability).toBe("out_of_stock");
    // Still priced: out of stock is a delivery-date question, not a pricing one.
    expect(result.price).not.toBeNull();
  });

  it("scopes stock to a plant when one is given", async () => {
    const all = await getMaterialAvailability(adapter(), KUNNR, "MAT-10001");
    const onePlant = await getMaterialAvailability(adapter(), KUNNR, "MAT-10001", {
      plant: "2000",
    });

    expect(onePlant.quantity).toBeLessThan(all.quantity!);
    expect(onePlant.plant).toBe("2000");
  });

  it("404s an unknown material", async () => {
    await expect(getMaterialAvailability(adapter(), KUNNR, "MAT-NOPE")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });
});

describe("getProductDetail", () => {
  it("returns plant-wise stock, highest first, with the material master", async () => {
    const detail = await getProductDetail(adapter(), KUNNR, "MAT-10001");

    expect(detail.material.description).toContain("Hydraulic Pump");
    expect(detail.stock.length).toBeGreaterThan(1);
    expect(detail.stock[0]!.quantity).toBeGreaterThanOrEqual(detail.stock[1]!.quantity);
    expect(detail.totalQuantity).toBe(detail.stock.reduce((sum, s) => sum + s.quantity, 0));
  });

  it("prices at the MOQ by default, since that is the smallest orderable quantity", async () => {
    const detail = await getProductDetail(adapter(), KUNNR, "MAT-20001");
    expect(detail.price?.quantity).toBe(detail.material.minimumOrderQty);
  });

  it("degrades to an error only for real failures", async () => {
    const error = await getProductDetail(adapter({ unavailable: true }), KUNNR, "MAT-10001").catch(
      (e: unknown) => e,
    );
    expect(isCatalogueError(error) && error.code).toBe("upstream_unavailable");
  });
});

describe("getPriceList", () => {
  it("lists every catalogue material with its condition record and validity", async () => {
    const list = await getPriceList(adapter(), KUNNR);
    const all = await browseCatalogue(adapter());

    expect(list.rows).toHaveLength(all.page.total);
    expect(list.currency).toBe("INR");

    const priced = list.rows.find((row) => row.netPrice !== null)!;
    expect(priced.conditionRecord).toBeTruthy();
    expect(priced.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(priced.validTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("applies the customer's own discount — two customers see different net prices", async () => {
    const [a, b] = await Promise.all([
      getPriceList(adapter(), "0010001001"),
      getPriceList(adapter(), "0010001002"),
    ]);

    const netFor = (list: typeof a, material: string) =>
      list.rows.find((row) => row.material === material)?.netPrice;

    expect(netFor(a, "MAT-10001")).not.toBe(netFor(b, "MAT-10001"));
  });
});
