import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { isInvoiceError } from "./errors";
import {
  getInvoice,
  getInvoicePdfUrl,
  listCreditDebitNotes,
  listInvoices,
} from "./invoice-service";

/**
 * The billing module against the mock SAP driver. Nothing here touches the
 * database, because nothing in this module is stored (ADR-016 extended to
 * billing documents) — the service is pure composition over the adapter.
 */

const KUNNR = "0010001001";
/** Seeded: open, due in 17 days, intra-state (CGST+SGST). */
const OPEN_INVOICE = "0090002211";
/** Seeded: overdue by 28 days. */
const OVERDUE_INVOICE = "0090002190";
/** Seeded: belongs to OTHER_KUNNR, inter-state (IGST). */
const OTHER_INVOICE = "0090002205";
/** Seeded: credit note (FKART G2) against OVERDUE_INVOICE. */
const CREDIT_NOTE = "0090002250";

const sap = (options = {}) => new MockSapAdapter(options);

describe("listInvoices", () => {
  it("returns the account's invoices with the read's own freshness", async () => {
    const result = await listInvoices(sap(), KUNNR);

    expect(result.invoices.length).toBeGreaterThan(0);
    expect(result.invoices.every((i) => i.kunnr === KUNNR)).toBe(true);
    expect(result.freshness).toBe("live");
  });

  it("keeps credit notes out of the invoice list by default", async () => {
    const result = await listInvoices(sap(), KUNNR);

    expect(result.invoices.map((i) => i.vbeln)).not.toContain(CREDIT_NOTE);
  });

  it("filters by the customer's own vocabulary", async () => {
    const open = await listInvoices(sap(), KUNNR, { filter: "open" });
    expect(open.invoices.every((i) => i.status === "Open" || i.status === "Overdue")).toBe(true);

    const overdue = await listInvoices(sap(), KUNNR, { filter: "overdue" });
    expect(overdue.invoices.every((i) => i.status === "Overdue")).toBe(true);

    const paid = await listInvoices(sap(), KUNNR, { filter: "paid" });
    expect(paid.invoices.every((i) => i.status === "Paid" || i.status === "Cleared")).toBe(true);
  });

  it("reports the filtered count rather than the unfiltered total", async () => {
    const overdue = await listInvoices(sap(), KUNNR, { filter: "overdue" });
    expect(overdue.total).toBe(overdue.invoices.length);
  });

  it("decorates each row with its tax split and days to due", async () => {
    const result = await listInvoices(sap(), KUNNR, { filter: "overdue" });
    const row = result.invoices.find((i) => i.vbeln === OVERDUE_INVOICE);

    expect(row?.tax.placeOfSupply).toBe("intra-state");
    expect(row?.daysOverdue).toBeGreaterThan(0);
    expect(row?.dueInDays).toBeLessThan(0);
  });

  it("carries the aging summary alongside the list", async () => {
    const result = await listInvoices(sap(), KUNNR);

    expect(result.aging?.totalOutstanding).toBeGreaterThan(0);
    expect(result.aging?.buckets).toHaveLength(4);
  });

  it("never shows another account's invoices", async () => {
    const result = await listInvoices(sap(), KUNNR);

    expect(result.invoices.map((i) => i.vbeln)).not.toContain(OTHER_INVOICE);
  });

  it("refuses a session with no sold-to account", async () => {
    await expect(listInvoices(sap(), undefined)).rejects.toMatchObject({ code: "no_account" });
  });

  it("surfaces a SAP outage as retryable rather than as an empty list", async () => {
    await expect(listInvoices(sap({ unavailable: true }), KUNNR)).rejects.toMatchObject({
      code: "upstream_unavailable",
      status: 503,
    });
  });
});

describe("listCreditDebitNotes", () => {
  it("returns only the notes, which the invoice list excludes", async () => {
    const notes = await listCreditDebitNotes(sap(), KUNNR);

    expect(notes.invoices.map((i) => i.vbeln)).toEqual([CREDIT_NOTE]);
    expect(notes.invoices[0]?.billingType).toBe("G2");
    expect(notes.invoices[0]?.reasonCode).toBe("003");
  });

  it("keeps the credit negative, so it can't read as money owed", async () => {
    const notes = await listCreditDebitNotes(sap(), KUNNR);

    expect(notes.invoices[0]?.grossAmount).toBeLessThan(0);
  });
});

describe("getInvoice", () => {
  it("returns the document with its tax card and FI position", async () => {
    const detail = await getInvoice(sap(), KUNNR, OPEN_INVOICE);

    expect(detail.invoice.vbeln).toBe(OPEN_INVOICE);
    expect(detail.tax.placeOfSupply).toBe("intra-state");
    expect(detail.tax.cgst).toBeGreaterThan(0);
    expect(detail.openItem?.openAmount).toBeGreaterThan(0);
    expect(detail.payable).toBe(true);
  });

  it("builds the O2C spine from the originating order", async () => {
    const detail = await getInvoice(sap(), KUNNR, OPEN_INVOICE);

    expect(detail.timeline.map((stage) => stage.key)).toEqual([
      "order",
      "creditCheck",
      "delivery",
      "invoice",
      "payment",
    ]);
    expect(detail.timeline.find((s) => s.key === "invoice")?.status).toBe("Invoiced");
  });

  it("lists the credit notes raised against the invoice", async () => {
    const detail = await getInvoice(sap(), KUNNR, OVERDUE_INVOICE);

    expect(detail.notes.map((n) => n.vbeln)).toContain(CREDIT_NOTE);
  });

  it("answers 404 for another customer's invoice, never 403", async () => {
    try {
      await getInvoice(sap(), KUNNR, OTHER_INVOICE);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isInvoiceError(error) && error.status).toBe(404);
    }
  });

  it("gives the same answer for an invoice that never existed", async () => {
    const missing = await getInvoice(sap(), KUNNR, "0099999999").catch((e: unknown) => e);
    const theirs = await getInvoice(sap(), KUNNR, OTHER_INVOICE).catch((e: unknown) => e);

    expect(isInvoiceError(missing) && missing.status).toBe(404);
    expect(isInvoiceError(theirs) && theirs.status).toBe(404);
  });

  it("does not offer a settled invoice for payment", async () => {
    const detail = await getInvoice(sap(), KUNNR, "0090002140");
    expect(detail.payable).toBe(false);
  });

  it("does not offer a credit note for payment", async () => {
    const detail = await getInvoice(sap(), KUNNR, CREDIT_NOTE);
    expect(detail.payable).toBe(false);
  });
});

describe("getInvoicePdfUrl", () => {
  it("returns the billing document's PDF", async () => {
    await expect(getInvoicePdfUrl(sap(), KUNNR, OPEN_INVOICE)).resolves.toContain(OPEN_INVOICE);
  });

  it("re-checks ownership, because a URL is shareable", async () => {
    await expect(getInvoicePdfUrl(sap(), KUNNR, OTHER_INVOICE)).rejects.toMatchObject({
      status: 404,
    });
  });
});
