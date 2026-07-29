import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it, vi } from "vitest";

import { isInquiryError } from "./errors";
import { listInquiries, getInquiry } from "./inquiry-service";
import {
  acceptQuotation,
  getQuotation,
  listQuotations,
  requestRevision,
} from "./quotation-service";
import { listInquiryQueue } from "./workbench-service";

/**
 * The read side of Module 3, which is all of it bar the drafts: SAP owns both
 * documents, so these run against the mock adapter with no database at all.
 * The flow suite in `__tests__` covers the parts that touch Postgres.
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
const NOW = new Date("2026-07-26T09:00:00.000Z");

const context = { tenantId: "tenant-test", kunnr: KUNNR, userId: "user-1" };
const sap = () => new MockSapAdapter({ today: "2026-07-26" });

/**
 * Every write in this module records an outbox event, and `@cc/db` needs a
 * real database for that. The event contract is exercised by the flow suite;
 * here the writes are about the SAP side, so the recorder is stubbed out.
 */
vi.mock("@cc/db", () => ({
  runWithTenant: <T>(_tenantId: string, fn: () => Promise<T>) => fn(),
  recordEvent: vi.fn(async () => "outbox-row-id"),
  db: {},
  getTenantId: () => "tenant-test",
}));

async function expectInquiryError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isInquiryError(error)) return error;
    throw error;
  }
  throw new Error("Expected an InquiryError to be thrown");
}

describe("listInquiries", () => {
  it("returns only this account's inquiries, with their waiting state", async () => {
    const result = await listInquiries(sap(), context);

    expect(result.inquiries.every((i) => i.kunnr === KUNNR)).toBe(true);
    expect(result.freshness).toBe("live");
    expect(result.inquiries.find((i) => i.vbeln === "0010000801")?.awaitingQuotation).toBe(true);
    expect(result.inquiries.find((i) => i.vbeln === "0010000795")?.awaitingQuotation).toBe(false);
  });

  it("filters to the ones still waiting on sales", async () => {
    const result = await listInquiries(sap(), context, { filter: "awaiting" });

    expect(result.inquiries.map((i) => i.vbeln)).toEqual(["0010000801"]);
    expect(result.total).toBe(1);
  });

  it("refuses a session with no sold-to account", async () => {
    const error = await expectInquiryError(() =>
      listInquiries(sap(), { ...context, kunnr: undefined }),
    );
    expect(error.code).toBe("no_account");
  });
});

describe("getInquiry", () => {
  it("joins the quotation raised against it", async () => {
    const detail = await getInquiry(sap(), context, "0010000795");

    expect(detail.quotation?.vbeln).toBe("0020000901");
    expect(detail.awaitingQuotation).toBe(false);
  });

  it("404s another customer's inquiry rather than admitting it exists", async () => {
    const error = await expectInquiryError(() => getInquiry(sap(), context, "0010000806"));
    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
  });

  it("404s an inquiry that never existed, with the same answer", async () => {
    const error = await expectInquiryError(() => getInquiry(sap(), context, "0010009999"));
    expect(error.code).toBe("not_found");
  });
});

describe("listQuotations", () => {
  it("derives validity from BNDDT at read time and sorts by what lapses first", async () => {
    const result = await listQuotations(sap(), context, { now: NOW });

    expect(result.quotations.map((q) => q.quotation.vbeln)).toEqual([
      "0020000884", // valid until tomorrow
      "0020000901", // 23 days out
      "0020000860", // expired 12 days ago
    ]);
    expect(result.quotations[0]?.validity.state).toBe("expiring");
    expect(result.quotations[2]?.validity.state).toBe("expired");
  });

  it("carries the tax split SAP calculated, never a computed one", async () => {
    const result = await listQuotations(sap(), context, { now: NOW });
    const quotation = result.quotations.find((q) => q.quotation.vbeln === "0020000901");

    expect(quotation?.tax.placeOfSupply).toBe("intra-state");
    expect(quotation?.tax.totalTax).toBe(134136);
  });

  it("filters on states that are derived from the clock, not stored", async () => {
    const expiring = await listQuotations(sap(), context, { filter: "expiring", now: NOW });
    expect(expiring.quotations.map((q) => q.quotation.vbeln)).toEqual(["0020000884"]);

    const expired = await listQuotations(sap(), context, { filter: "expired", now: NOW });
    expect(expired.quotations.map((q) => q.quotation.vbeln)).toEqual(["0020000860"]);

    // The same quotation moves between filters as time passes, with nothing
    // having happened to it in SAP — which is the point of not storing it.
    const later = await listQuotations(sap(), context, {
      filter: "expired",
      now: new Date("2026-07-28T09:00:00.000Z"),
    });
    expect(later.quotations.map((q) => q.quotation.vbeln)).toContain("0020000884");
  });
});

describe("getQuotation", () => {
  it("says why a quotation can't be accepted rather than just disabling it", async () => {
    const expired = await getQuotation(sap(), context, "0020000860", { now: NOW });
    expect(expired.acceptBlock).toBe("expired");
    // Revision is still offered — that is doc 05's "Request revalidation".
    expect(expired.revisable).toBe(true);
  });

  it("404s another customer's quotation", async () => {
    const error = await expectInquiryError(() =>
      getQuotation(sap(), { ...context, kunnr: OTHER_KUNNR }, "0020000901"),
    );
    expect(error.code).toBe("not_found");
  });
});

describe("acceptQuotation", () => {
  it("converts with reference and carries the quoted price onto the order", async () => {
    const adapter = sap();
    const result = await acceptQuotation(
      adapter,
      context,
      "0020000901",
      { shipTo: KUNNR, customerPoRef: "PO-SH-9100" },
      { now: NOW },
    );

    expect(result.order.lines[0]?.netPrice).toBe(621);
    expect(result.order.netValue).toBe(745200);

    const after = await getQuotation(adapter, context, "0020000901", { now: NOW });
    expect(after.quotation.salesOrder).toBe(result.order.vbeln);
    expect(after.acceptBlock).toBe("converted");
  });

  it("refuses an expired quotation with an explanation, before calling SAP", async () => {
    const adapter = sap();
    const spy = vi.spyOn(adapter, "convertQuoteToOrder");

    const error = await expectInquiryError(() =>
      acceptQuotation(adapter, context, "0020000860", { shipTo: KUNNR }, { now: NOW }),
    );

    expect(error.code).toBe("not_allowed");
    expect(error.message).toMatch(/revalidated/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-checks expiry against SAP's own document, not the caller's screen", async () => {
    // The quotation is live now and lapsed by the time the button is pressed:
    // the check uses the clock at call time, so the stale page cannot convert.
    const error = await expectInquiryError(() =>
      acceptQuotation(
        sap(),
        context,
        "0020000884",
        { shipTo: KUNNR },
        { now: new Date("2026-07-29T09:00:00.000Z") },
      ),
    );
    expect(error.code).toBe("not_allowed");
  });

  it("404s another customer's quotation rather than converting it", async () => {
    const error = await expectInquiryError(() =>
      acceptQuotation(
        sap(),
        { ...context, kunnr: OTHER_KUNNR },
        "0020000901",
        { shipTo: OTHER_KUNNR },
        { now: NOW },
      ),
    );
    expect(error.code).toBe("not_found");
  });

  it("rejects a missing ship-to as a field issue", async () => {
    const error = await expectInquiryError(() =>
      acceptQuotation(sap(), context, "0020000901", { shipTo: "" }, { now: NOW }),
    );
    expect(error.code).toBe("invalid");
    expect(error.issues[0]?.field).toBe("shipTo");
  });
});

describe("requestRevision", () => {
  it("records the ask against the SAP document", async () => {
    const view = await requestRevision(
      sap(),
      context,
      "0020000901",
      { comment: "Can you hold this price to 600 per metre?" },
      { now: NOW },
    );

    expect(view.quotation.revisionRequests).toHaveLength(1);
  });

  it("is how an expired quotation is revalidated", async () => {
    const view = await requestRevision(
      sap(),
      context,
      "0020000860",
      { comment: "This lapsed before we could approve it — please revalidate." },
      { now: NOW },
    );

    expect(view.validity.state).toBe("expired");
    expect(view.quotation.revisionRequests).toHaveLength(1);
  });

  it("refuses once the quotation has become an order", async () => {
    const adapter = sap();
    await acceptQuotation(adapter, context, "0020000901", { shipTo: KUNNR }, { now: NOW });

    const error = await expectInquiryError(() =>
      requestRevision(
        adapter,
        context,
        "0020000901",
        { comment: "Actually, could we change the quantity?" },
        { now: NOW },
      ),
    );
    expect(error.code).toBe("not_allowed");
  });

  it("wants enough text to act on", async () => {
    const error = await expectInquiryError(() =>
      requestRevision(sap(), context, "0020000901", { comment: "too short" }, { now: NOW }),
    );
    expect(error.issues[0]?.field).toBe("comment");
  });
});

describe("listInquiryQueue (back office)", () => {
  it("spans accounts and puts the longest-waiting first", async () => {
    const queue = await listInquiryQueue(sap(), { now: NOW });

    expect(queue.inquiries.map((i) => i.vbeln)).toEqual(["0010000806", "0010000801"]);
    expect(queue.inquiries[0]?.waitingDays).toBe(2);
    expect(queue.inquiries.every((i) => !i.quotation)).toBe(true);
  });
});

describe("SAP outage", () => {
  it("reports an outage as retryable rather than as an empty list", async () => {
    const error = await expectInquiryError(() =>
      listQuotations(new MockSapAdapter({ unavailable: true }), context),
    );
    expect(error.code).toBe("upstream_unavailable");
    expect(error.status).toBe(503);
  });
});
