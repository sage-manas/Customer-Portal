import { describe, expect, it } from "vitest";

import { GstnError } from "../errors";

import { MockGstnAdapter } from "./driver";
import { GSTN_UNREGISTERED_SPECIMEN } from "./seed";

const FIXED_NOW = () => new Date("2026-07-27T10:00:00.000Z");

function adapter(options = {}) {
  return new MockGstnAdapter({ now: FIXED_NOW, ...options });
}

describe("MockGstnAdapter", () => {
  it("returns the seeded taxpayer for a known GSTIN", async () => {
    const taxpayer = await adapter().verifyGstin("27AAPFU0939F1ZV");

    expect(taxpayer).toMatchObject({
      legalName: "Vertex Polymers Private Limited",
      stateCode: "27",
      status: "Active",
      registrationType: "01",
    });
    expect(taxpayer.checkedAt).toBe("2026-07-27T10:00:00.000Z");
  });

  it("normalizes case and surrounding whitespace", async () => {
    const taxpayer = await adapter().verifyGstin("  27aapfu0939f1zv ");
    expect(taxpayer.legalName).toBe("Vertex Polymers Private Limited");
  });

  it("reports a cancelled registration rather than hiding it", async () => {
    const taxpayer = await adapter().verifyGstin("24AAACC1206D1ZM");
    expect(taxpayer.status).toBe("Cancelled");
  });

  it("rejects a malformed GSTIN before making a call", async () => {
    await expect(adapter().verifyGstin("27AAPFU0939F1ZZ")).rejects.toMatchObject({
      kind: "invalid_format",
    });
  });

  it("reports the unregistered specimen as not found", async () => {
    await expect(adapter().verifyGstin(GSTN_UNREGISTERED_SPECIMEN)).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("synthesizes an active taxpayer for any other valid GSTIN, deterministically", async () => {
    const first = await adapter().verifyGstin("19AADCH9012P1Z4");
    const second = await adapter().verifyGstin("19AADCH9012P1Z4");

    expect(first.status).toBe("Active");
    expect(first.stateCode).toBe("19");
    expect(first.legalName).toBe(second.legalName);
    // Never an echo of the applicant's own input — a name mismatch has to
    // stay observable for the reviewer.
    expect(first.legalName).toMatch(/Private Limited$/);
  });

  it("fails retryably when GSTN is unreachable", async () => {
    const error = await adapter({ unavailable: true })
      .verifyGstin("27AAPFU0939F1ZV")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GstnError);
    expect(error).toMatchObject({ kind: "unavailable", retryable: true });
    // The copy tells the applicant they are not blocked (docs/05 P7).
    expect((error as GstnError).message).toContain("continue");
  });

  it("reports its health", async () => {
    expect(await adapter().health()).toMatchObject({ reachable: true, driver: "mock" });
    expect(await adapter({ unavailable: true }).health()).toMatchObject({ reachable: false });
  });

  it("accepts extra fixtures for demo tenants", async () => {
    const custom = adapter({
      registry: {
        "29AAGCB7383J1Z4": {
          gstin: "29AAGCB7383J1Z4",
          legalName: "Demo Tenant Fixture",
          stateCode: "29",
          status: "Active" as const,
        },
      },
    });
    expect((await custom.verifyGstin("29AAGCB7383J1Z4")).legalName).toBe("Demo Tenant Fixture");
  });
});
