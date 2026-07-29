import { describe, expect, it } from "vitest";

import { isSapError, type SapError } from "../errors";

import { MockSapAdapter } from "./driver";
import { SEED_TODAY } from "./seed";

const KUNNR = "0010001001";
/** Deccan Fabricators — seeded at 98% credit utilisation. */
const TIGHT_CREDIT_KUNNR = "0010001002";

const adapter = () => new MockSapAdapter({ today: SEED_TODAY });

async function expectSapError(fn: () => Promise<unknown>): Promise<SapError> {
  try {
    await fn();
  } catch (error) {
    if (isSapError(error)) return error;
    throw error;
  }
  throw new Error("Expected a SapError to be thrown");
}

describe("health / outage simulation", () => {
  it("reports reachable by default", async () => {
    const health = await adapter().health();
    expect(health).toMatchObject({ reachable: true, driver: "mock", circuit: "closed" });
  });

  it("fails every call with a retryable error when the outage flag is set", async () => {
    const sap = new MockSapAdapter({ unavailable: true });
    const error = await expectSapError(() => sap.getMaterials());
    expect(error.kind).toBe("unavailable");
    expect(error.retryable).toBe(true);
    expect((await sap.health()).circuit).toBe("open");
  });
});

describe("reads carry freshness (docs/05 §6.1)", () => {
  it("tags reads with a freshness class and sync timestamp", async () => {
    const read = await adapter().getMaterials();
    expect(read.freshness).toBe("live");
    expect(read.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("catalogue", () => {
  it("filters by search over MATNR and MAKTX", async () => {
    const byCode = await adapter().getMaterials({ search: "MAT-10001" });
    expect(byCode.data.items.map((m) => m.material)).toEqual(["MAT-10001"]);

    const byText = await adapter().getMaterials({ search: "gasket" });
    expect(byText.data.items.length).toBe(2);
  });

  it("filters by material group and plant", async () => {
    const byGroup = await adapter().getMaterials({ materialGroup: "PUMPS" });
    expect(byGroup.data.items.every((m) => m.materialGroup === "PUMPS")).toBe(true);

    const byPlant = await adapter().getMaterials({ plant: "2000" });
    expect(byPlant.data.items.map((m) => m.material)).toContain("MAT-40001");
    expect(byPlant.data.items.map((m) => m.material)).not.toContain("MAT-30001");
  });

  it("paginates while reporting the unpaginated total", async () => {
    const page = await adapter().getMaterials({ limit: 3, offset: 3 });
    expect(page.data.items).toHaveLength(3);
    expect(page.data.total).toBeGreaterThan(3);
  });

  it("returns per-plant stock, including zero-stock rows", async () => {
    const stock = await adapter().getStock("MAT-10004");
    expect(stock.data).toEqual([expect.objectContaining({ plant: "2000", quantity: 0 })]);
  });

  it("404s an unknown material rather than returning an empty shape", async () => {
    const error = await expectSapError(() => adapter().getMaterial("MAT-99999"));
    expect(error.kind).toBe("not_found");
  });
});

describe("customer-specific pricing", () => {
  it("applies the customer's material-specific condition over their default", async () => {
    const price = await adapter().getCustomerPrice(KUNNR, "MAT-10001", 5);
    expect(price.data.listPrice).toBe(48500);
    expect(price.data.discountPercent).toBe(12.5);
    expect(price.data.netPrice).toBe(42437.5);
  });

  it("prices different customers differently for the same material", async () => {
    const sap = adapter();
    const a = await sap.getCustomerPrice(KUNNR, "MAT-30001", 10);
    const b = await sap.getCustomerPrice(TIGHT_CREDIT_KUNNR, "MAT-30001", 10);
    expect(a.data.netPrice).toBeLessThan(b.data.netPrice);
  });
});

describe("credit", () => {
  it("derives `available` rather than trusting the stored value", async () => {
    const credit = await adapter().getCreditInfo(KUNNR);
    expect(credit.data.available).toBe(credit.data.creditLimit - credit.data.utilized);
  });
});

describe("ATP simulation", () => {
  it("confirms in full on the requested date when stock covers the line", async () => {
    const simulation = await adapter().simulateOrder({
      kunnr: KUNNR,
      requestedDeliveryDate: "2026-08-15",
      shipTo: KUNNR,
      lines: [{ material: "MAT-10001", quantity: 10, uom: "EA" }],
    });
    expect(simulation.lines[0]).toMatchObject({
      confirmedQty: 10,
      partial: false,
      confirmedDate: "2026-08-15",
    });
  });

  it("confirms partially and pushes the date out by the lead time when short", async () => {
    const simulation = await adapter().simulateOrder({
      kunnr: KUNNR,
      requestedDeliveryDate: "2026-08-01",
      shipTo: KUNNR,
      lines: [{ material: "MAT-10002", quantity: 20, uom: "EA" }],
    });
    expect(simulation.lines[0]).toMatchObject({ confirmedQty: 8, partial: true });
    // MAT-10002 has a 10-day lead time from SEED_TODAY (2026-07-26).
    expect(simulation.lines[0]?.confirmedDate).toBe("2026-08-05");
  });

  it("rejects a quantity below the material's MOQ", async () => {
    const error = await expectSapError(() =>
      adapter().simulateOrder({
        kunnr: KUNNR,
        requestedDeliveryDate: "2026-08-01",
        shipTo: KUNNR,
        lines: [{ material: "MAT-20001", quantity: 5, uom: "M" }],
      }),
    );
    expect(error.kind).toBe("validation");
    expect(error.field).toBe("quantity");
    expect(error.message).toContain("Minimum order quantity");
  });

  it("flags an expected credit block before the order is submitted", async () => {
    const simulation = await adapter().simulateOrder({
      kunnr: TIGHT_CREDIT_KUNNR,
      requestedDeliveryDate: "2026-08-01",
      shipTo: TIGHT_CREDIT_KUNNR,
      lines: [{ material: "MAT-10001", quantity: 5, uom: "EA" }],
    });
    expect(simulation.creditBlockExpected).toBe(true);
  });
});

describe("order creation", () => {
  const input = {
    kunnr: KUNNR,
    customerPoRef: "PO-TEST-001",
    requestedDeliveryDate: "2026-08-20",
    shipTo: KUNNR,
    lines: [{ material: "MAT-10003", quantity: 20, uom: "EA" }],
  };

  it("creates an order that is then readable, and consumes credit exposure", async () => {
    const sap = adapter();
    const before = await sap.getCreditInfo(KUNNR);
    const created = await sap.createSalesOrder(input);

    expect(created.vbeln).toMatch(/^\d{10}$/);
    expect(created.creditStatus).toBe("Confirmed");
    expect(created.orderStatus).toBe("Open");

    const read = await sap.getOrderStatus(created.vbeln);
    expect(read.data.customerPoRef).toBe("PO-TEST-001");
    expect(read.data.lines[0]?.netValue).toBe(created.lines[0]?.netValue);

    const after = await sap.getCreditInfo(KUNNR);
    expect(after.data.utilized).toBe(before.data.utilized + created.netValue);
  });

  it("is idempotent on the customer PO reference (docs/02 §4.3)", async () => {
    const sap = adapter();
    const first = await sap.createSalesOrder(input);
    const second = await sap.createSalesOrder(input);
    expect(second.vbeln).toBe(first.vbeln);

    const orders = await sap.getOrders(KUNNR);
    expect(orders.data.items.filter((o) => o.customerPoRef === "PO-TEST-001")).toHaveLength(1);
  });

  it("puts an order over the credit limit on hold with nothing confirmed", async () => {
    const sap = adapter();
    const created = await sap.createSalesOrder({
      kunnr: TIGHT_CREDIT_KUNNR,
      customerPoRef: "DF/2026/999",
      requestedDeliveryDate: "2026-08-20",
      shipTo: TIGHT_CREDIT_KUNNR,
      lines: [{ material: "MAT-10001", quantity: 10, uom: "EA" }],
    });
    expect(created.creditStatus).toBe("CreditHold");
    expect(created.lines.every((l) => l.confirmedQty === 0)).toBe(true);
  });

  it("rejects an empty order", async () => {
    const error = await expectSapError(() => adapter().createSalesOrder({ ...input, lines: [] }));
    expect(error.kind).toBe("validation");
  });

  it("does not let one adapter instance see another's writes", async () => {
    const a = adapter();
    await a.createSalesOrder(input);
    const fresh = adapter();
    const orders = await fresh.getOrders(KUNNR);
    expect(orders.data.items.some((o) => o.customerPoRef === "PO-TEST-001")).toBe(false);
  });
});

describe("order cancellation (VA02 rejection)", () => {
  const input = {
    kunnr: KUNNR,
    customerPoRef: "PO-CANCEL-001",
    requestedDeliveryDate: "2026-08-20",
    shipTo: KUNNR,
    lines: [{ material: "MAT-10003", quantity: 20, uom: "EA" }],
  };

  it("closes the order and gives back the credit exposure it consumed", async () => {
    const sap = adapter();
    const before = await sap.getCreditInfo(KUNNR);
    const created = await sap.createSalesOrder(input);

    const cancelled = await sap.cancelSalesOrder(created.vbeln, "Ordered in error");
    expect(cancelled.orderStatus).toBe("Closed");

    const read = await sap.getOrderStatus(created.vbeln);
    expect(read.data.rejectionReason).toBe("Ordered in error");
    expect(read.data.lines.every((l) => l.confirmedQty === 0)).toBe(true);

    const after = await sap.getCreditInfo(KUNNR);
    expect(after.data.utilized).toBe(before.data.utilized);
  });

  it("releases the PO reference, so the same PO can be re-raised", async () => {
    const sap = adapter();
    const first = await sap.createSalesOrder(input);
    await sap.cancelSalesOrder(first.vbeln);

    const second = await sap.createSalesOrder(input);
    expect(second.vbeln).not.toBe(first.vbeln);
  });

  it("refuses once the order is past fully-open — a delivery already references it", async () => {
    // 0000004712 is the seeded part-delivered order.
    const error = await expectSapError(() => adapter().cancelSalesOrder("0000004712"));
    expect(error.kind).toBe("validation");
  });

  it("404s an unknown order rather than reporting success", async () => {
    const error = await expectSapError(() => adapter().cancelSalesOrder("0000009999"));
    expect(error.kind).toBe("not_found");
  });
});

describe("customer creation", () => {
  const applicant = {
    legalEntityName: "Test Manufacturing Private Limited Extremely Long Trading Name",
    customerType: "Z001",
    address: {
      street: "1 Test Road",
      city: "Mumbai",
      region: "27",
      postalCode: "400001",
      country: "IN",
    },
    contact: { contactPerson: "Test Person", email: "t@example.test", phone: "+912200000000" },
    tax: { pan: "AAACT1234A", gstin: "27AAACT1234A1Z5" },
  };

  it("assigns a KUNNR and truncates to the registry's SAP field length", async () => {
    const sap = adapter();
    const result = await sap.createCustomer(applicant);
    expect(result.kunnr).toMatch(/^\d{10}$/);
    // KNA1-NAME1 is CHAR 35 per the sap-mapping registry.
    expect(result.customer.legalEntityName).toHaveLength(35);

    const read = await sap.getCustomer(result.kunnr);
    expect(read.data.tax.gstin).toBe(applicant.tax.gstin);
  });

  it("rejects a duplicate GSTIN the way SAP rejects a duplicate tax number", async () => {
    const sap = adapter();
    const error = await expectSapError(() =>
      sap.createCustomer({ ...applicant, tax: { ...applicant.tax, gstin: "27AABCS1429P1ZK" } }),
    );
    expect(error.kind).toBe("validation");
    expect(error.field).toBe("gstin");
    expect(error.sapMessageId).toBe("F2/018");
  });
});

describe("billing and AR", () => {
  it("returns only the requested customer's invoices, newest first", async () => {
    const invoices = await adapter().getInvoices(KUNNR);
    expect(invoices.data.items.every((i) => i.kunnr === KUNNR)).toBe(true);
    const dates = invoices.data.items.map((i) => i.billingDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("seeds both intra-state (CGST+SGST) and inter-state (IGST) tax splits", async () => {
    const sap = adapter();
    const maharashtra = await sap.getInvoice("0090002211");
    const karnataka = await sap.getInvoice("0090002205");
    expect(maharashtra.data.igst).toBe(0);
    expect(maharashtra.data.cgst).toBeGreaterThan(0);
    expect(karnataka.data.igst).toBeGreaterThan(0);
    expect(karnataka.data.cgst).toBe(0);
  });

  it("clears an open item on a full payment", async () => {
    const sap = adapter();
    const result = await sap.postIncomingPayment({
      kunnr: KUNNR,
      amount: 143252,
      currency: "INR",
      gatewayReference: "pay_abc123",
      allocations: [{ documentNumber: "0090002190", amount: 143252 }],
    });
    expect(result.clearedItems).toEqual(["0090002190"]);

    const items = await sap.getOpenItems(KUNNR);
    const cleared = items.data.find((i) => i.documentNumber === "0090002190");
    expect(cleared).toMatchObject({ status: "Cleared", openAmount: 0 });
  });

  it("leaves a residual open item on a partial payment", async () => {
    const sap = adapter();
    const result = await sap.postIncomingPayment({
      kunnr: KUNNR,
      amount: 50000,
      currency: "INR",
      gatewayReference: "pay_partial",
      allocations: [{ documentNumber: "0090002190", amount: 50000 }],
    });
    expect(result.clearedItems).toEqual([]);
    expect(result.residualItems).toEqual(["0090002190"]);

    const items = await sap.getOpenItems(KUNNR);
    expect(items.data.find((i) => i.documentNumber === "0090002190")?.openAmount).toBe(93252);
  });

  it("posts only once for a repeated gateway webhook", async () => {
    const sap = adapter();
    const payload = {
      kunnr: KUNNR,
      amount: 143252,
      currency: "INR",
      gatewayReference: "pay_dupe",
      allocations: [{ documentNumber: "0090002190", amount: 143252 }],
    };
    const first = await sap.postIncomingPayment(payload);
    const second = await sap.postIncomingPayment(payload);
    expect(second.documentNumber).toBe(first.documentNumber);

    const items = await sap.getOpenItems(KUNNR);
    expect(items.data.filter((i) => i.documentType === "DZ")).toHaveLength(1);
  });

  it("hides another customer's open item behind not_found, never a 403", async () => {
    const error = await expectSapError(() =>
      adapter().postIncomingPayment({
        kunnr: TIGHT_CREDIT_KUNNR,
        amount: 1000,
        currency: "INR",
        gatewayReference: "pay_crosscustomer",
        allocations: [{ documentNumber: "0090002190", amount: 1000 }],
      }),
    );
    expect(error.kind).toBe("not_found");
  });

  it("rejects an allocation larger than the open balance", async () => {
    const error = await expectSapError(() =>
      adapter().postIncomingPayment({
        kunnr: KUNNR,
        amount: 999999,
        currency: "INR",
        gatewayReference: "pay_over",
        allocations: [{ documentNumber: "0090002190", amount: 999999 }],
      }),
    );
    expect(error.kind).toBe("validation");
  });
});

describe("delivery", () => {
  it("links deliveries to their sales order (LIKP-VGBEL)", async () => {
    const deliveries = await adapter().getDeliveriesForOrder("0000004712");
    expect(deliveries.data).toHaveLength(2);
    expect(deliveries.data.map((d) => d.status).sort()).toEqual(["InTransit", "Packed"]);
    expect(deliveries.data.find((d) => d.status === "InTransit")?.ewayBillNumber).toBeDefined();
  });

  it("lists a customer's deliveries by KUNNR, newest dispatch first", async () => {
    const deliveries = await adapter().getDeliveries("0010001001");

    expect(deliveries.data.total).toBe(3);
    expect(deliveries.data.items.every((d) => d.kunnr === "0010001001")).toBe(true);
  });

  it("does not return another customer's deliveries", async () => {
    const deliveries = await adapter().getDeliveries("0010001002");
    expect(deliveries.data.items).toHaveLength(0);
  });

  describe("confirmPod (VLPOD)", () => {
    it("records the receipt and completes the delivery", async () => {
      const sap = adapter();
      const result = await sap.confirmPod({
        deliveryVbeln: "0080001947",
        receiptDate: SEED_TODAY,
        lines: [{ lineNo: 10, receivedQty: 150 }],
      });

      expect(result).toMatchObject({ status: "Delivered", discrepancy: false });

      const after = await sap.getDelivery("0080001947");
      expect(after.data.podConfirmed).toBe(true);
      expect(after.data.podReceiptDate).toBe(SEED_TODAY);
    });

    it("accepts a short receipt and reports it as a discrepancy", async () => {
      // A shortfall is a fact to be reported, not an invalid input: SAP takes
      // the POD and the difference is what raises the ticket.
      const result = await adapter().confirmPod({
        deliveryVbeln: "0080001947",
        receiptDate: SEED_TODAY,
        lines: [{ lineNo: 10, receivedQty: 140 }],
      });

      expect(result.discrepancy).toBe(true);
    });

    it("refuses a second POD on the same delivery", async () => {
      const error = await expectSapError(() =>
        adapter().confirmPod({
          deliveryVbeln: "0080001901",
          receiptDate: SEED_TODAY,
          lines: [{ lineNo: 10, receivedQty: 12 }],
        }),
      );
      expect(error.kind).toBe("validation");
    });

    it("refuses a delivery that has not been despatched", async () => {
      const error = await expectSapError(() =>
        adapter().confirmPod({
          deliveryVbeln: "0080001960",
          receiptDate: SEED_TODAY,
          lines: [{ lineNo: 10, receivedQty: 50 }],
        }),
      );
      expect(error.kind).toBe("validation");
    });

    it("404s an unknown delivery", async () => {
      const error = await expectSapError(() =>
        adapter().confirmPod({
          deliveryVbeln: "0080009999",
          receiptDate: SEED_TODAY,
          lines: [{ lineNo: 10, receivedQty: 1 }],
        }),
      );
      expect(error.kind).toBe("not_found");
    });
  });
});

describe("inquiry & quotation (Module 3)", () => {
  const inquiry = {
    kunnr: KUNNR,
    requiredDeliveryDate: "2026-08-20",
    validityDays: 30,
    lines: [{ material: "MAT-10001", quantity: 6, uom: "EA" }],
  };

  it("creates an inquiry with no prices on it — that is the question it asks", async () => {
    const created = await adapter().createInquiry(inquiry);

    expect(created.vbeln).toMatch(/^\d{10}$/);
    expect(created.status).toBe("Open");
    expect(created.quotation).toBeUndefined();
    expect(created.lines[0]).toMatchObject({ lineNo: 10, netPrice: 0, netValue: 0 });
  });

  it("refuses an empty inquiry and a zero quantity, as VA11 would", async () => {
    const empty = await expectSapError(() => adapter().createInquiry({ ...inquiry, lines: [] }));
    expect(empty.kind).toBe("validation");

    const zero = await expectSapError(() =>
      adapter().createInquiry({
        ...inquiry,
        lines: [{ material: "MAT-10001", quantity: 0, uom: "EA" }],
      }),
    );
    expect(zero.field).toBe("quantity");
  });

  it("lists a customer's own inquiries only", async () => {
    const sap = adapter();
    const mine = await sap.getInquiries(KUNNR);
    expect(mine.data.items.every((i) => i.kunnr === KUNNR)).toBe(true);

    const other = await sap.getInquiries(TIGHT_CREDIT_KUNNR);
    expect(other.data.items.map((i) => i.vbeln)).toEqual(["0010000806"]);
  });

  it("gives the back office every unanswered inquiry, oldest first", async () => {
    const queue = await adapter().getInquiryQueue();

    expect(queue.data.items.every((i) => !i.quotation)).toBe(true);
    // Across accounts: the workbench is a tenant queue, not a customer's list.
    expect(new Set(queue.data.items.map((i) => i.kunnr)).size).toBeGreaterThan(1);
    expect(queue.data.items.map((i) => i.vbeln)).toEqual(["0010000806", "0010000801"]);
  });

  describe("auto-quote (docs/07 A4)", () => {
    it("answers an inquiry once the sales desk's window has passed", async () => {
      const sap = new MockSapAdapter({ today: SEED_TODAY, autoQuoteAfterMs: 0 });
      const created = await sap.createInquiry(inquiry);

      const after = await sap.getInquiry(created.vbeln);
      expect(after.data.quotation).toBeDefined();
      expect(after.data.status).toBe("Closed");

      const quotations = await sap.getQuotations(KUNNR);
      const issued = quotations.data.items.find((q) => q.inquiry === created.vbeln);
      expect(issued?.lines[0]?.netPrice).toBeGreaterThan(0);
      // Sharma is in state 27, like the supplying plants: CGST + SGST.
      expect(issued?.igst).toBe(0);
      expect(issued?.cgst).toBeGreaterThan(0);
      expect(issued?.grossValue).toBeGreaterThan(issued!.netValue);
    });

    it("leaves the inquiry alone while the window is still open", async () => {
      const sap = new MockSapAdapter({ today: SEED_TODAY, autoQuoteAfterMs: 60_000 });
      const created = await sap.createInquiry(inquiry);

      expect((await sap.getInquiry(created.vbeln)).data.quotation).toBeUndefined();
      expect((await sap.getInquiryQueue()).data.items.map((i) => i.vbeln)).toContain(created.vbeln);
    });

    it("never overrules a quotation the sales desk issued by hand", async () => {
      const sap = new MockSapAdapter({ today: SEED_TODAY, autoQuoteAfterMs: 0 });
      const created = await sap.createInquiry(inquiry);

      const manual = await sap.createQuotation({
        inquiryVbeln: created.vbeln,
        validUntil: "2026-08-31",
        lines: [{ lineNo: 10, netPrice: 40000 }],
      });

      const quotations = await sap.getQuotations(KUNNR);
      expect(quotations.data.items.filter((q) => q.inquiry === created.vbeln)).toHaveLength(1);
      expect(manual.lines[0]?.netPrice).toBe(40000);
      expect(manual.netValue).toBe(240000);
    });
  });

  it("refuses to quote an inquiry twice", async () => {
    const sap = adapter();
    const error = await expectSapError(() =>
      sap.createQuotation({ inquiryVbeln: "0010000795", validUntil: "2026-08-31" }),
    );
    expect(error.kind).toBe("validation");
  });

  it("refuses a quotation whose validity has already passed", async () => {
    const sap = adapter();
    const error = await expectSapError(() =>
      sap.createQuotation({ inquiryVbeln: "0010000801", validUntil: "2026-07-01" }),
    );
    expect(error.field).toBe("validUntil");
  });

  it("records a revision request against the document, not a portal row", async () => {
    const sap = adapter();
    const revised = await sap.requestQuotationRevision("0020000901", "Can you hold this to 600/M?");

    expect(revised.revisionRequests).toHaveLength(1);
    expect((await sap.getQuotation("0020000901")).data.revisionRequests?.[0]?.comment).toMatch(
      /600\/M/,
    );
  });

  describe("convertQuoteToOrder (VA01 with reference)", () => {
    it("creates the order at the quoted prices and closes the quotation", async () => {
      const sap = adapter();
      const order = await sap.convertQuoteToOrder({
        quotationVbeln: "0020000901",
        shipTo: KUNNR,
        customerPoRef: "PO-SH-9001",
      });

      // Copy control: the quoted price is carried, not re-derived.
      expect(order.lines[0]?.netPrice).toBe(621);
      expect(order.netValue).toBe(745200);

      const quotation = await sap.getQuotation("0020000901");
      expect(quotation.data.salesOrder).toBe(order.vbeln);
      expect(quotation.data.status).toBe("Closed");

      const created = await sap.getOrderStatus(order.vbeln);
      expect(created.data.kunnr).toBe(KUNNR);
    });

    it("refuses a second conversion of the same quotation", async () => {
      const sap = adapter();
      await sap.convertQuoteToOrder({ quotationVbeln: "0020000901", shipTo: KUNNR });

      const error = await expectSapError(() =>
        sap.convertQuoteToOrder({ quotationVbeln: "0020000901", shipTo: KUNNR }),
      );
      expect(error.kind).toBe("validation");
    });

    it("refuses an expired quotation", async () => {
      const error = await expectSapError(() =>
        adapter().convertQuoteToOrder({ quotationVbeln: "0020000860", shipTo: KUNNR }),
      );
      expect(error.kind).toBe("validation");
    });

    it("404s an unknown quotation", async () => {
      const error = await expectSapError(() =>
        adapter().convertQuoteToOrder({ quotationVbeln: "0020009999", shipTo: KUNNR }),
      );
      expect(error.kind).toBe("not_found");
    });
  });
});
