import { describe, expect, it } from "vitest";

import { mapPresalesGbstkToStatus } from "../status";

import {
  canRequestQuotationRevision,
  inquiryDraftSchema,
  inquiryRequiredDateIssue,
  inquiryWriteSchema,
  isQuotationAcceptable,
  QUOTATION_EXPIRY_WARNING_HOURS,
  quotationAcceptBlock,
  quotationTax,
  quotationValidity,
  toCreateInquiryInput,
} from "./inquiry";
import type { Quotation } from "./sales-doc";

const NOW = new Date("2026-07-26T09:00:00.000Z");

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    vbeln: "0020000901",
    kunnr: "0010001001",
    createdOn: "2026-07-20",
    validUntil: "2026-08-19",
    status: "Open",
    lines: [],
    netValue: 100000,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    grossValue: 118000,
    currency: "INR",
    ...overrides,
  };
}

describe("inquiryWriteSchema", () => {
  const valid = {
    requiredDeliveryDate: "2026-08-10",
    lines: [{ material: "MAT-10001", quantity: 5, uom: "EA" }],
  };

  it("accepts a minimal inquiry", () => {
    expect(inquiryWriteSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an inquiry with no items — there is nothing to price", () => {
    const result = inquiryWriteSchema.safeParse({ ...valid, lines: [] });
    expect(result.success).toBe(false);
  });

  it("refuses a zero quantity, as VA11 itself would", () => {
    const result = inquiryWriteSchema.safeParse({
      ...valid,
      lines: [{ material: "MAT-10001", quantity: 0, uom: "EA" }],
    });
    expect(result.success).toBe(false);
  });

  it("takes the required date's format from the registry (VBAK-VDATU is DATS)", () => {
    const result = inquiryWriteSchema.safeParse({ ...valid, requiredDeliveryDate: "10-08-2026" });
    expect(result.success).toBe(false);
  });

  it("caps the notes at STXH-TDLINE's 2000 characters", () => {
    const result = inquiryWriteSchema.safeParse({ ...valid, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("lets a draft carry nothing at all — a draft you can't save isn't one", () => {
    const draft = inquiryDraftSchema.safeParse({});
    expect(draft.success).toBe(true);
    expect(draft.success && draft.data.lines).toEqual([]);
  });
});

describe("toCreateInquiryInput", () => {
  it("takes the sold-to from the session rather than the form", () => {
    const input = toCreateInquiryInput("0010001001", {
      requiredDeliveryDate: "2026-08-10",
      lines: [{ material: "MAT-10001", quantity: 5, uom: "EA" }],
    });

    expect(input.kunnr).toBe("0010001001");
    expect(input.lines).toEqual([{ material: "MAT-10001", quantity: 5, uom: "EA" }]);
  });
});

describe("inquiryRequiredDateIssue", () => {
  it("rejects a date in the past", () => {
    expect(inquiryRequiredDateIssue("2026-07-25", "2026-07-26")).toMatch(/isn't in the past/);
  });

  it("accepts today", () => {
    expect(inquiryRequiredDateIssue("2026-07-26", "2026-07-26")).toBeNull();
  });

  it("enforces the caller's lead time when one is supplied", () => {
    expect(inquiryRequiredDateIssue("2026-07-28", "2026-07-26", 5)).toMatch(/2026-07-31/);
    expect(inquiryRequiredDateIssue("2026-08-02", "2026-07-26", 5)).toBeNull();
  });
});

describe("quotationValidity", () => {
  it("treats BNDDT inclusively — a quotation valid until today is still valid", () => {
    expect(quotationValidity("2026-07-26", NOW).state).toBe("expiring");
  });

  it("expires only once the last day is over", () => {
    expect(quotationValidity("2026-07-25", NOW).state).toBe("expired");
    expect(quotationValidity("2026-07-25", NOW).remainingMs).toBeLessThan(0);
  });

  it(`warns inside the ${QUOTATION_EXPIRY_WARNING_HOURS}h window and not before`, () => {
    expect(quotationValidity("2026-07-28", NOW).state).toBe("expiring");
    expect(quotationValidity("2026-08-19", NOW).state).toBe("valid");
  });

  it("counts whole days left for the chip", () => {
    expect(quotationValidity("2026-07-29", NOW).remainingDays).toBe(3);
    expect(quotationValidity("2026-07-01", NOW).remainingDays).toBe(0);
  });
});

describe("quotationAcceptBlock", () => {
  it("allows a live quotation", () => {
    expect(quotationAcceptBlock(quotation(), NOW)).toBeNull();
    expect(isQuotationAcceptable(quotation(), NOW)).toBe(true);
  });

  it("names the reason so the screen can explain it", () => {
    expect(quotationAcceptBlock(quotation({ validUntil: "2026-07-01" }), NOW)).toBe("expired");
    expect(quotationAcceptBlock(quotation({ salesOrder: "0000004720" }), NOW)).toBe("converted");
    expect(quotationAcceptBlock(quotation({ status: "Closed" }), NOW)).toBe("closed");
  });

  it("reports an already-converted quotation as converted, not expired", () => {
    const stale = quotation({ salesOrder: "0000004720", validUntil: "2026-07-01" });
    expect(quotationAcceptBlock(stale, NOW)).toBe("converted");
  });
});

describe("canRequestQuotationRevision", () => {
  it("allows revalidation after expiry — that is what the button is for", () => {
    expect(canRequestQuotationRevision(quotation({ validUntil: "2026-07-01" }))).toBe(true);
  });

  it("refuses once the quotation has become an order", () => {
    expect(canRequestQuotationRevision(quotation({ salesOrder: "0000004720" }))).toBe(false);
  });
});

describe("quotationTax", () => {
  it("reads the split SAP populated rather than computing GST", () => {
    const tax = quotationTax(quotation());
    expect(tax.placeOfSupply).toBe("intra-state");
    expect(tax.totalTax).toBe(18000);
    expect(tax.ratePercent).toBe(18);
  });

  it("reports inter-state when IGST is the populated condition", () => {
    const tax = quotationTax(
      quotation({ cgst: 0, sgst: 0, igst: 18000, netValue: 100000, grossValue: 118000 }),
    );
    expect(tax.placeOfSupply).toBe("inter-state");
  });
});

describe("mapPresalesGbstkToStatus", () => {
  it("never calls a pre-sales document partially delivered", () => {
    expect(mapPresalesGbstkToStatus("A")).toBe("Open");
    expect(mapPresalesGbstkToStatus("B")).toBe("InProcess");
    expect(mapPresalesGbstkToStatus("C")).toBe("Closed");
  });
});
