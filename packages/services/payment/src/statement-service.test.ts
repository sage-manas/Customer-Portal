import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { getStatement, listPayableItems } from "./statement-service";

/**
 * The statement half of the payments module against the mock SAP driver.
 * Nothing here is stored — BSID/BSAD are SAP's — so this suite needs no
 * database. The stored half (payments themselves) has its own Postgres
 * suite in src/__tests__.
 */

const KUNNR = "0010001001";
const OPEN_INVOICE = "0090002211";
const OVERDUE_INVOICE = "0090002190";
/** Seeded: cleared, so not payable. */
const PAID_INVOICE = "0090002140";
/** Seeded: credit note with a negative FI posting. */
const CREDIT_NOTE = "0090002250";

const sap = (options = {}) => new MockSapAdapter(options);

describe("getStatement", () => {
  it("returns a running balance with the read's own freshness", async () => {
    const result = await getStatement(sap(), KUNNR);

    expect(result.statement.lines.length).toBeGreaterThan(0);
    expect(result.freshness).toBe("live");
  });

  it("orders postings by date and carries the balance through them", async () => {
    const { statement } = await getStatement(sap(), KUNNR);

    const dates = statement.lines.map((l) => l.postingDate);
    expect([...dates].sort()).toEqual(dates);

    // Each balance is the previous one plus this row's net movement.
    statement.lines.reduce((previous, line) => {
      expect(line.balance).toBeCloseTo(previous + line.debit - line.credit, 2);
      return line.balance;
    }, 0);
  });

  it("shows a credit note as a credit, reducing the balance", async () => {
    const { statement } = await getStatement(sap(), KUNNR);
    const note = statement.lines.find((l) => l.documentNumber === CREDIT_NOTE);

    expect(note?.credit).toBeGreaterThan(0);
    expect(note?.debit).toBe(0);
  });

  it("filters by document type without disturbing the balance arithmetic", async () => {
    const all = await getStatement(sap(), KUNNR);
    const invoicesOnly = await getStatement(sap(), KUNNR, { docTypes: ["RV"] });

    expect(invoicesOnly.statement.lines.every((l) => l.documentType === "RV")).toBe(true);
    expect(invoicesOnly.statement.lines.length).toBeLessThan(all.statement.lines.length);
  });

  it("keeps the aging over the whole ledger, not the filtered range", async () => {
    const all = await getStatement(sap(), KUNNR);
    const narrow = await getStatement(sap(), KUNNR, { from: "2099-01-01" });

    expect(narrow.statement.lines).toHaveLength(0);
    // The account position doesn't change because the customer changed a filter.
    expect(narrow.aging.totalOutstanding).toBe(all.aging.totalOutstanding);
  });

  it("excludes the negative credit posting from what the customer owes", async () => {
    const { aging } = await getStatement(sap(), KUNNR);

    expect(aging.totalOutstanding).toBeGreaterThan(0);
    expect(aging.buckets.every((bucket) => bucket.amount >= 0)).toBe(true);
  });

  it("refuses a session with no sold-to account", async () => {
    await expect(getStatement(sap(), undefined)).rejects.toMatchObject({ code: "no_account" });
  });

  it("surfaces a SAP outage as retryable", async () => {
    await expect(getStatement(sap({ unavailable: true }), KUNNR)).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});

describe("listPayableItems", () => {
  it("offers only items with something left open", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    expect(result.items.every((item) => item.openAmount > 0)).toBe(true);
    expect(result.items.map((i) => i.documentNumber)).toContain(OPEN_INVOICE);
    expect(result.items.map((i) => i.documentNumber)).toContain(OVERDUE_INVOICE);
  });

  it("never offers a settled invoice", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    expect(result.items.map((i) => i.documentNumber)).not.toContain(PAID_INVOICE);
  });

  it("never offers a credit note — its posting is negative", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    expect(result.items.map((i) => i.documentNumber)).not.toContain(CREDIT_NOTE);
  });

  it("sorts oldest-due first, so the overdue rows lead", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    const dueDates = result.items.map((i) => i.dueDate);
    expect([...dueDates].sort()).toEqual(dueDates);
  });

  it("totals what is outstanding across the selectable rows", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    const sum = result.items.reduce((total, item) => total + item.openAmount, 0);
    expect(result.totalOutstanding).toBeCloseTo(sum, 2);
  });

  it("marks how overdue each row is, for the highlighted rows", async () => {
    const result = await listPayableItems(sap(), KUNNR);
    const overdue = result.items.find((i) => i.documentNumber === OVERDUE_INVOICE);

    expect(overdue?.daysOverdue).toBeGreaterThan(0);
  });

  it("never offers another account's open items", async () => {
    const result = await listPayableItems(sap(), KUNNR);

    // 0090002205 belongs to 0010001002.
    expect(result.items.map((i) => i.documentNumber)).not.toContain("0090002205");
  });
});
