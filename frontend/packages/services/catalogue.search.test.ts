import { beforeEach, describe, expect, it } from "vitest";

import { MockSapAdapter } from "../sap-mock";

import { searchMaterials } from "./catalogue";

/**
 * Pins the match-code rules behind MaterialSearchBox's server search
 * (REMEDIATION-PLAN §5 / §7 Tier 2), including the regressions found and
 * fixed by hand while building it: substring (not prefix-only) matching on
 * the material code, matching across the buyer-typed separator, and not
 * matching everything on a bare punctuation query.
 */
describe("searchMaterials", () => {
  let adapter: MockSapAdapter;

  beforeEach(() => {
    adapter = new MockSapAdapter({ latencyMs: 0 });
  });

  it("matches a material code by a substring anywhere in it, not just a prefix", async () => {
    const hits = await searchMaterials(adapter, "10001");
    expect(hits.map((h) => h.material)).toContain("MAT-10001");
  });

  it("matches when the buyer omits the separator", async () => {
    const hits = await searchMaterials(adapter, "MAT10001");
    expect(hits.map((h) => h.material)).toContain("MAT-10001");
  });

  it("matches a description by word prefix", async () => {
    const hits = await searchMaterials(adapter, "hydraulic");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.description.toLowerCase().includes("hydraulic"))).toBe(true);
  });

  it("does not match everything on a bare punctuation query", async () => {
    const hits = await searchMaterials(adapter, "-");
    expect(hits).toEqual([]);
  });

  it("returns nothing for an empty or whitespace-only term", async () => {
    expect(await searchMaterials(adapter, "")).toEqual([]);
    expect(await searchMaterials(adapter, "   ")).toEqual([]);
  });

  it("caps hits at the given limit", async () => {
    const hits = await searchMaterials(adapter, "mat", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});
