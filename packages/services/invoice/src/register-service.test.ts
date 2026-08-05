import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { isInvoiceError } from "./errors";
import {
  listInvoiceRegister,
  listNoteRegister,
  listRefundQueue,
  payRefund,
  refundReference,
} from "./register-service";

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

describe("payRefund", () => {
  it("pays what the live queue says is open, and the queue then empties", async () => {
    const sap = adapter();
    const before = await listRefundQueue(sap, { today: SEED_TODAY });
    const target = before.refunds[0]!;

    const paid = await payRefund(
      sap,
      { vbeln: target.vbeln, initiatedBy: "user-ap-1" },
      { today: SEED_TODAY },
    );

    expect(paid.paidAmount).toBe(target.openAmount);
    expect(paid.clearedItems).toContain(target.vbeln);
    expect(paid.kunnr).toBe(target.kunnr);

    const after = await listRefundQueue(sap, { today: SEED_TODAY });
    expect(after.refunds.map((r) => r.vbeln)).not.toContain(target.vbeln);
  });

  it("refuses a second payout because the credit is no longer outstanding", async () => {
    const sap = adapter();
    const target = (await listRefundQueue(sap, { today: SEED_TODAY })).refunds[0]!;

    const first = await payRefund(sap, { vbeln: target.vbeln }, { today: SEED_TODAY });
    // The re-read is what refuses here — the item is cleared, so there is
    // nothing outstanding to pay. SAP's dedupe on the reference is the second
    // line of defence and is asserted where it lives, in the driver suite.
    await expect(payRefund(sap, { vbeln: target.vbeln }, { today: SEED_TODAY })).rejects.toSatisfy(
      isInvoiceError,
    );
    expect(first.paidAmount).toBeGreaterThan(0);
  });

  it("derives the idempotency key from the document, so two clicks share one", () => {
    // The property the driver's dedupe depends on: a key that varied per call
    // would make SAP's protection unreachable, and the two-click case above
    // would then rest on the re-read alone.
    // Pinned to the exact string rather than compared to a second call: two
    // calls a millisecond apart would agree even if the key carried a
    // timestamp, which is precisely the mistake worth failing on.
    expect(refundReference("0090002250")).toBe("refund:0090002250");
    expect(refundReference("0090002251")).toBe("refund:0090002251");
  });

  it("refuses a document that is not an outstanding credit, without saying which", async () => {
    const sap = adapter();
    const invoice = (await listInvoiceRegister(sap, { today: SEED_TODAY })).rows[0]!;

    await expect(payRefund(sap, { vbeln: invoice.vbeln }, { today: SEED_TODAY })).rejects.toSatisfy(
      isInvoiceError,
    );
    await expect(payRefund(sap, { vbeln: "0099999999" }, { today: SEED_TODAY })).rejects.toSatisfy(
      isInvoiceError,
    );
  });
});
