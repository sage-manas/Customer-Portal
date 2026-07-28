import { describe, expect, it } from "vitest";

import {
  agingBucketFor,
  billingKind,
  buildAging,
  buildStatement,
  daysOverdue,
  dueInDays,
  invoiceTax,
  isCreditOrDebitNote,
  isPayable,
  placeOfSupplyLabel,
} from "./ar";
import type { Invoice, OpenItem } from "./sales-doc";

const TODAY = "2026-07-28";

function openItem(overrides: Partial<OpenItem> & Pick<OpenItem, "documentNumber">): OpenItem {
  return {
    documentType: "RV",
    postingDate: "2026-07-01",
    dueDate: "2026-07-31",
    amount: 1000,
    openAmount: 1000,
    currency: "INR",
    status: "Open",
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> & Pick<Invoice, "vbeln">): Invoice {
  return {
    billingDate: "2026-07-01",
    kunnr: "0010001001",
    taxableAmount: 1000,
    cgst: 90,
    sgst: 90,
    igst: 0,
    grossAmount: 1180,
    currency: "INR",
    dueDate: "2026-07-31",
    status: "Open",
    ...overrides,
  };
}

describe("due dates", () => {
  it("counts the due day itself as not yet late", () => {
    expect(dueInDays(TODAY, TODAY)).toBe(0);
    expect(daysOverdue(TODAY, TODAY)).toBe(0);
  });

  it("goes negative once past due", () => {
    expect(dueInDays("2026-07-20", TODAY)).toBe(-8);
    expect(daysOverdue("2026-07-20", TODAY)).toBe(8);
  });

  it("ignores the time of day so a due date doesn't flip mid-day", () => {
    expect(dueInDays("2026-07-31T23:59:00Z", "2026-07-28T00:01:00Z")).toBe(3);
  });
});

describe("aging buckets", () => {
  it("puts not-yet-due items in the current bucket", () => {
    expect(agingBucketFor("2026-12-31", TODAY)).toBe("current");
  });

  it("buckets by days past due at each boundary", () => {
    expect(agingBucketFor("2026-06-28", TODAY)).toBe("current"); // 30 days
    expect(agingBucketFor("2026-06-27", TODAY)).toBe("d31to60"); // 31 days
    expect(agingBucketFor("2026-05-29", TODAY)).toBe("d31to60"); // 60 days
    expect(agingBucketFor("2026-05-28", TODAY)).toBe("d61to90"); // 61 days
    expect(agingBucketFor("2026-04-29", TODAY)).toBe("d61to90"); // 90 days
    expect(agingBucketFor("2026-04-28", TODAY)).toBe("over90"); // 91 days
  });

  it("sums outstanding balances and separates the overdue part", () => {
    const aging = buildAging(
      [
        openItem({ documentNumber: "1", dueDate: "2026-08-30", openAmount: 500 }),
        openItem({ documentNumber: "2", dueDate: "2026-06-01", openAmount: 300 }),
        openItem({ documentNumber: "3", dueDate: "2026-01-01", openAmount: 200 }),
      ],
      TODAY,
    );

    expect(aging.totalOutstanding).toBe(1000);
    expect(aging.totalOverdue).toBe(500);
    expect(aging.buckets.find((b) => b.key === "current")?.amount).toBe(500);
    expect(aging.buckets.find((b) => b.key === "d31to60")?.amount).toBe(300);
    expect(aging.buckets.find((b) => b.key === "over90")?.amount).toBe(200);
  });

  it("excludes cleared items rather than bucketing them at zero", () => {
    const aging = buildAging(
      [
        openItem({ documentNumber: "1", openAmount: 0, status: "Cleared" }),
        openItem({ documentNumber: "2", openAmount: 400 }),
      ],
      TODAY,
    );

    expect(aging.totalOutstanding).toBe(400);
    expect(aging.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });
});

describe("statement", () => {
  const items: OpenItem[] = [
    openItem({ documentNumber: "RV1", postingDate: "2026-05-01", amount: 1000 }),
    openItem({ documentNumber: "RV2", postingDate: "2026-06-01", amount: 500 }),
    openItem({
      documentNumber: "DZ1",
      documentType: "DZ",
      postingDate: "2026-06-15",
      amount: -600,
      openAmount: 0,
      status: "Cleared",
    }),
    openItem({ documentNumber: "RV3", postingDate: "2026-07-01", amount: 250 }),
  ];

  it("runs a balance in posting-date order and splits debit from credit", () => {
    const statement = buildStatement(items);

    expect(statement.lines.map((l) => l.balance)).toEqual([1000, 1500, 900, 1150]);
    expect(statement.lines[2]).toMatchObject({ debit: 0, credit: 600 });
    expect(statement.totalDebits).toBe(1750);
    expect(statement.totalCredits).toBe(600);
    expect(statement.closingBalance).toBe(1150);
  });

  it("carries the real balance into a filtered range as the opening balance", () => {
    const statement = buildStatement(items, { from: "2026-06-10" });

    expect(statement.openingBalance).toBe(1500);
    expect(statement.lines.map((l) => l.documentNumber)).toEqual(["DZ1", "RV3"]);
    // The running balance stays absolute rather than restarting at zero.
    expect(statement.closingBalance).toBe(1150);
  });

  it("filters by document type without disturbing the balance", () => {
    const statement = buildStatement(items, { docTypes: ["DZ"] });

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0]?.balance).toBe(900);
  });

  it("returns an empty statement for an account with no postings", () => {
    const statement = buildStatement([]);

    expect(statement.lines).toEqual([]);
    expect(statement.closingBalance).toBe(0);
    expect(statement.currency).toBe("INR");
  });
});

describe("invoice tax", () => {
  it("reads an intra-state supply off the CGST/SGST pair", () => {
    const tax = invoiceTax(invoice({ vbeln: "1", taxableAmount: 1000, cgst: 90, sgst: 90 }));

    expect(tax.placeOfSupply).toBe("intra-state");
    expect(tax.totalTax).toBe(180);
    expect(tax.ratePercent).toBe(18);
    expect(placeOfSupplyLabel(tax)).toBe("Intra-state — CGST + SGST 18%");
  });

  it("reads an inter-state supply off IGST", () => {
    const tax = invoiceTax(
      invoice({ vbeln: "1", taxableAmount: 1000, cgst: 0, sgst: 0, igst: 180 }),
    );

    expect(tax.placeOfSupply).toBe("inter-state");
    expect(placeOfSupplyLabel(tax)).toBe("Inter-state — IGST 18%");
  });

  it("derives the rate from the amounts rather than a rate table", () => {
    const tax = invoiceTax(
      invoice({ vbeln: "1", taxableAmount: 1000, cgst: 25, sgst: 25, igst: 0 }),
    );

    expect(tax.ratePercent).toBe(5);
  });

  it("reports a zero rate on a zero-value document instead of dividing by zero", () => {
    const tax = invoiceTax(
      invoice({ vbeln: "1", taxableAmount: 0, cgst: 0, sgst: 0, grossAmount: 0 }),
    );

    expect(tax.ratePercent).toBe(0);
  });
});

describe("billing document kinds", () => {
  it("classifies FKART", () => {
    expect(billingKind("F2")).toBe("invoice");
    expect(billingKind("G2")).toBe("credit");
    expect(billingKind("L2")).toBe("debit");
  });

  it("treats an unknown or absent FKART as an invoice rather than dropping it", () => {
    expect(billingKind("ZF2")).toBe("invoice");
    expect(billingKind(undefined)).toBe("invoice");
  });

  it("only offers open invoices for payment", () => {
    expect(isPayable(invoice({ vbeln: "1", status: "Open" }))).toBe(true);
    expect(isPayable(invoice({ vbeln: "1", status: "Overdue" }))).toBe(true);
    expect(isPayable(invoice({ vbeln: "1", status: "Paid" }))).toBe(false);
    // A credit note is money owed *to* the customer — never payable.
    expect(isPayable(invoice({ vbeln: "1", status: "Open", billingType: "G2" }))).toBe(false);
    expect(isCreditOrDebitNote(invoice({ vbeln: "1", billingType: "G2" }))).toBe(true);
  });
});
