import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { isInvoiceError } from "./errors";
import { listInvoiceRegister, listNoteRegister, listRefundQueue } from "./register-service";

/**
 * The desk-plane registers. Every assertion here is about the boundary as
 * much as the arithmetic: these functions take no account, so what the tests
 * check is that they genuinely return more than one account's documents —
 * a desk read that quietly behaved like a customer's would pass a shape test
 * and fail the tenant.
 */

const adapter = () => new MockSapAdapter({ today: SEED_TODAY });

describe("listInvoiceRegister", () => {
  it("returns every account's invoices, newest first", async () => {
    const register = await listInvoiceRegister(adapter(), { today: SEED_TODAY });

    expect(new Set(register.rows.map((r) => r.kunnr)).size).toBeGreaterThan(1);
    const dates = register.rows.map((r) => r.billingDate);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(register.totalValue).toBeGreaterThan(0);
    expect(register.freshness).toBe("live");
  });

  it("excludes credit and debit notes — a credit is not a bill", async () => {
    const register = await listInvoiceRegister(adapter(), { today: SEED_TODAY });
    expect(register.rows.some((r) => r.billingType === "G2" || r.billingType === "L2")).toBe(false);
  });

  it("carries the tax SAP calculated rather than recomputing it", async () => {
    const register = await listInvoiceRegister(adapter(), { today: SEED_TODAY });
    const row = register.rows[0]!;
    expect(row.taxTotal).toBeCloseTo(row.cgst + row.sgst + row.igst, 2);
  });

  it("surfaces a SAP outage as a typed error, never as an empty register", async () => {
    const sap = new MockSapAdapter({ unavailable: true });
    await expect(listInvoiceRegister(sap)).rejects.toSatisfy(isInvoiceError);
  });
});

describe("listNoteRegister", () => {
  it("lists only notes, and totals their magnitude", async () => {
    const notes = await listNoteRegister(adapter(), { today: SEED_TODAY });

    expect(notes.rows.length).toBeGreaterThan(0);
    expect(notes.rows.every((r) => r.billingType === "G2" || r.billingType === "L2")).toBe(true);
    expect(notes.totalValue).toBeGreaterThan(0);
  });

  it("filters to one kind when asked", async () => {
    const credits = await listNoteRegister(adapter(), { today: SEED_TODAY, kind: "credit" });
    expect(credits.rows.every((r) => r.billingType === "G2")).toBe(true);

    const debits = await listNoteRegister(adapter(), { today: SEED_TODAY, kind: "debit" });
    expect(debits.rows.every((r) => r.billingType === "L2")).toBe(true);
  });
});

describe("listRefundQueue", () => {
  it("owes back a credit note whose FI item is still open, as a positive amount", async () => {
    const queue = await listRefundQueue(adapter(), { today: SEED_TODAY });

    expect(queue.refunds.length).toBeGreaterThan(0);
    expect(queue.refunds.every((r) => r.openAmount > 0)).toBe(true);
    expect(queue.totalOwed).toBeGreaterThan(0);
    expect(queue.freshness).toBe("live");
  });
});
