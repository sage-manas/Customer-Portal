import { describe, expect, it } from "vitest";

import { buildAging } from "./ar";
import type { RebateAgreement } from "./customer";
import {
  agingByCustomer,
  creditBlockedQueue,
  dunningCandidates,
  dunningLevelFor,
  rebateSettlementQueue,
  rebateSettlementState,
  refundCandidates,
  type LedgerOpenItem,
} from "./finance-desk";
import type { Invoice, OrderStatusView } from "./sales-doc";

const TODAY = "2026-08-05";

function item(over: Partial<LedgerOpenItem> & { kunnr: string; dueDate: string }): LedgerOpenItem {
  return {
    documentNumber: over.documentNumber ?? `90${Math.random().toString().slice(2, 8)}`,
    documentType: "RV",
    postingDate: "2026-01-01",
    amount: over.openAmount ?? 1000,
    openAmount: 1000,
    currency: "INR",
    status: "Open",
    ...over,
  };
}

describe("agingByCustomer", () => {
  it("buckets each account with the same arithmetic the customer's own statement uses", () => {
    const ledger = [
      item({ kunnr: "C1", dueDate: "2026-08-01", openAmount: 500 }),
      item({ kunnr: "C1", dueDate: "2026-01-01", openAmount: 900 }),
      item({ kunnr: "C2", dueDate: "2026-08-04", openAmount: 100 }),
    ];

    const rows = agingByCustomer(ledger, TODAY);

    expect(rows.map((r) => r.kunnr)).toEqual(["C1", "C2"]);
    expect(rows[0]?.aging).toEqual(
      buildAging(
        ledger.filter((i) => i.kunnr === "C1"),
        TODAY,
      ),
    );
    expect(rows[0]?.openItemCount).toBe(2);
  });

  it("drops accounts with nothing open — a desk queue lists work", () => {
    const rows = agingByCustomer(
      [item({ kunnr: "C3", dueDate: "2026-07-01", openAmount: 0, status: "Cleared" })],
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  it("sorts by overdue, not by outstanding", () => {
    const rows = agingByCustomer(
      [
        item({ kunnr: "BIG", dueDate: "2026-12-01", openAmount: 900_000 }),
        item({ kunnr: "LATE", dueDate: "2026-05-01", openAmount: 50_000 }),
      ],
      TODAY,
    );
    expect(rows[0]?.kunnr).toBe("LATE");
  });
});

describe("dunning", () => {
  it("escalates on the oldest overdue item, not the largest", () => {
    const candidates = dunningCandidates(
      [
        item({ kunnr: "C1", dueDate: "2026-01-01", openAmount: 1 }),
        item({ kunnr: "C1", dueDate: "2026-08-01", openAmount: 500_000 }),
      ],
      TODAY,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.level.key).toBe("final-notice");
    expect(candidates[0]?.documentCount).toBe(2);
  });

  it("lists nobody whose items are merely outstanding", () => {
    expect(dunningCandidates([item({ kunnr: "C1", dueDate: "2026-09-01" })], TODAY)).toEqual([]);
  });

  it("reads a level for every lateness, including none", () => {
    expect(dunningLevelFor(0).key).toBe("none");
    expect(dunningLevelFor(1).key).toBe("reminder");
    expect(dunningLevelFor(60).key).toBe("first-notice");
    expect(dunningLevelFor(500).key).toBe("final-notice");
  });
});

describe("refundCandidates", () => {
  const note = (over: Partial<Invoice>): Invoice => ({
    vbeln: "9000001",
    billingDate: "2026-06-01",
    kunnr: "C1",
    billingType: "G2",
    taxableAmount: 1000,
    cgst: 0,
    sgst: 0,
    igst: 180,
    grossAmount: 1180,
    currency: "INR",
    dueDate: "2026-06-30",
    status: "Open",
    ...over,
  });

  it("lists a credit note whose FI item is still open", () => {
    const rows = refundCandidates(
      [note({})],
      [item({ kunnr: "C1", dueDate: "2026-06-30", documentNumber: "9000001", openAmount: 1180 })],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.openAmount).toBe(1180);
  });

  it("reads a credit's negative FI posting as an amount owed back", () => {
    const rows = refundCandidates(
      [note({ grossAmount: -14325.2 })],
      [
        item({
          kunnr: "C1",
          dueDate: "2026-06-30",
          documentNumber: "9000001",
          amount: -14325.2,
          openAmount: -14325.2,
        }),
      ],
      TODAY,
    );
    expect(rows[0]?.openAmount).toBe(14325.2);
    expect(rows[0]?.noteAmount).toBe(14325.2);
  });

  it("treats a cleared note as settled rather than owed", () => {
    expect(refundCandidates([note({})], [], TODAY)).toEqual([]);
  });

  it("ignores invoices and debit notes", () => {
    const ledger = [
      item({ kunnr: "C1", dueDate: "2026-06-30", documentNumber: "9000001", openAmount: 1180 }),
    ];
    expect(refundCandidates([note({ billingType: "F2" })], ledger, TODAY)).toEqual([]);
    expect(refundCandidates([note({ billingType: "L2" })], ledger, TODAY)).toEqual([]);
  });
});

describe("rebate settlement", () => {
  const agreement = (over: Partial<RebateAgreement>): RebateAgreement => ({
    agreementNumber: "A1",
    kunnr: "C1",
    description: "Volume rebate",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    accruedAmount: 12_000,
    currency: "INR",
    ...over,
  });

  it("reads an unknown BOSTA as open, never as settled", () => {
    expect(rebateSettlementState(undefined).code).toBe("B");
    expect(rebateSettlementState("Z").code).toBe("B");
    expect(rebateSettlementState("D").settleable).toBe(false);
    expect(rebateSettlementState("C").settleable).toBe(true);
  });

  it("floats lapsed-and-unsettled agreements to the top", () => {
    const rows = rebateSettlementQueue(
      [
        agreement({ agreementNumber: "OPEN", settlementStatus: "B" }),
        agreement({ agreementNumber: "RELEASED", settlementStatus: "C" }),
        agreement({ agreementNumber: "LAPSED", settlementStatus: "B", validTo: "2026-03-31" }),
        agreement({ agreementNumber: "DONE", settlementStatus: "D", validTo: "2026-03-31" }),
      ],
      TODAY,
    );

    expect(rows[0]?.agreement.agreementNumber).toBe("LAPSED");
    expect(rows[0]?.overdueForSettlement).toBe(true);
    expect(rows.find((r) => r.agreement.agreementNumber === "DONE")?.overdueForSettlement).toBe(
      false,
    );
    expect(rows[1]?.agreement.agreementNumber).toBe("RELEASED");
  });
});

describe("creditBlockedQueue", () => {
  const order = (over: Partial<OrderStatusView>): OrderStatusView => ({
    vbeln: "5000001",
    kunnr: "C1",
    createdOn: "2026-08-01",
    orderStatus: "Open",
    creditStatus: "CreditHold",
    lines: [],
    netValue: 1000,
    currency: "INR",
    ...over,
  });

  it("holds the longest-waiting order first", () => {
    const rows = creditBlockedQueue(
      [order({ vbeln: "NEW" }), order({ vbeln: "OLD", createdOn: "2026-06-01" })],
      TODAY,
    );
    expect(rows.map((r) => r.order.vbeln)).toEqual(["OLD", "NEW"]);
    expect(rows[0]?.blockedDays).toBe(65);
  });
});
