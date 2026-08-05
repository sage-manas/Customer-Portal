import type {
  CanonicalCustomer,
  ConfirmPodInput,
  ConfirmPodResult,
  ConvertQuotationInput,
  CreateInquiryInput,
  CreateQuotationInput,
  CreateSalesOrderInput,
  CreditInfo,
  CustomerCreateResult,
  CustomerPatch,
  CustomerPrice,
  CustomerUpdateResult,
  Delivery,
  IncomingPaymentInput,
  IncomingPaymentResult,
  Inquiry,
  Invoice,
  Material,
  MaterialQuery,
  LedgerOpenItem,
  OpenItem,
  OrderSimulation,
  OrderStatusView,
  Page,
  Quotation,
  RebateAgreement,
  SalesDocLine,
  SalesOrderResult,
  ShipToAddress,
  StockLevel,
} from "@cc/domain";
import { onboardingMapping } from "@cc/domain";

import { sapRead, type SapAdapter, type SapConnectionHealth, type SapRead } from "../contract";
import { sapNotFound, sapUnavailable, sapValidation } from "../errors";

import {
  PLANTS,
  SEED_CREDIT,
  SEED_CUSTOMERS,
  SEED_DELIVERIES,
  SEED_DISCOUNTS,
  SEED_INQUIRIES,
  SEED_INVOICES,
  SEED_LIST_PRICES,
  SEED_MATERIALS,
  SEED_OPEN_ITEMS,
  SEED_OPEN_ITEM_OWNER,
  SEED_ORDERS,
  SEED_PRICE_VALIDITY,
  SEED_QUOTATIONS,
  SEED_REBATES,
  SEED_SHIP_TOS,
  SEED_STOCK,
  SEED_TODAY,
  SUPPLYING_REGION,
  shiftDays,
} from "./seed";

/**
 * Full in-memory simulation of the SAP adapter contract.
 *
 * It is not a set of canned responses: ATP is computed against seeded
 * stock, credit checks against seeded KNKK exposure, prices against seeded
 * condition records, and writes mutate the store so a created order is
 * readable afterwards. That is the point of mock-first (docs/06) — every
 * later phase can be built and tested end to end, including the unhappy
 * paths (credit hold, partial confirmation, SAP unreachable), without an
 * SAP system.
 *
 * Behaviour is tunable per instance via `MockSapOptions` so tests and demo
 * tenants can force outages, latency or a fixed clock.
 */

export interface MockSapOptions {
  /** Artificial round-trip latency, so loading/skeleton states are real. */
  latencyMs?: number;
  /** When true every call fails with a retryable `unavailable` SapError. */
  unavailable?: boolean;
  /** Fixed "today" (ISO date) for deterministic ATP/aging in tests. */
  today?: string;
  /** Percentage credit headroom below which an order is blocked (CMGST=B). */
  creditToleranceRatio?: number;
  /**
   * How long the simulated sales desk takes to answer an inquiry (docs/07 A4:
   * "sales-side auto-quotes after a delay to make the flow demoable"). The
   * default leaves a real window in which the admin workbench can issue the
   * quotation by hand — an inquiry answered the instant it is raised would
   * make the back-office screen untestable. Tests set 0.
   */
  autoQuoteAfterMs?: number;
  /** VBAK-BNDDT the auto-quote issues with, in days from `today`. */
  quotationValidityDays?: number;
}

interface MockStore {
  customers: CanonicalCustomer[];
  shipTos: ShipToAddress[];
  credit: CreditInfo[];
  rebates: RebateAgreement[];
  materials: Material[];
  stock: StockLevel[];
  inquiries: Inquiry[];
  quotations: Quotation[];
  /** inquiry VBELN -> epoch ms at which the simulated sales desk answers. */
  autoQuoteDue: Map<string, number>;
  orders: OrderStatusView[];
  deliveries: Delivery[];
  invoices: Invoice[];
  openItems: OpenItem[];
  openItemOwner: Record<string, string>;
  /** gatewayReference -> result, for idempotent payment posting. */
  postedPayments: Map<string, IncomingPaymentResult>;
  /** customerPoRef -> vbeln, for idempotent order creation (docs/02 §4.3). */
  orderIdempotency: Map<string, string>;
  nextOrderNumber: number;
  nextInquiryNumber: number;
  nextQuotationNumber: number;
  nextCustomerNumber: number;
  nextFiDocument: number;
}

const clone = <T>(value: T): T => structuredClone(value);

/** Field lengths come from the registry, never hand-copied (CLAUDE.md rule 3). */
function truncateToSapLength(portalField: string, value: string): string {
  const def = onboardingMapping.find((f) => f.portalField === portalField);
  return def?.length ? value.slice(0, def.length) : value;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Quantities are QUAN(13,3) in SAP — compare them at that precision. */
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export class MockSapAdapter implements SapAdapter {
  readonly driver = "mock" as const;

  private readonly store: MockStore;
  private readonly options: Required<MockSapOptions>;

  constructor(options: MockSapOptions = {}) {
    this.options = {
      latencyMs: options.latencyMs ?? 0,
      unavailable: options.unavailable ?? false,
      today: options.today ?? SEED_TODAY,
      creditToleranceRatio: options.creditToleranceRatio ?? 1,
      autoQuoteAfterMs: options.autoQuoteAfterMs ?? 90_000,
      quotationValidityDays: options.quotationValidityDays ?? 30,
    };

    this.store = {
      customers: clone(SEED_CUSTOMERS),
      shipTos: clone(SEED_SHIP_TOS),
      credit: clone(SEED_CREDIT),
      rebates: clone(SEED_REBATES),
      materials: clone(SEED_MATERIALS),
      stock: clone(SEED_STOCK),
      inquiries: clone(SEED_INQUIRIES),
      quotations: clone(SEED_QUOTATIONS),
      autoQuoteDue: new Map(),
      orders: clone(SEED_ORDERS),
      deliveries: clone(SEED_DELIVERIES),
      invoices: clone(SEED_INVOICES),
      openItems: clone(SEED_OPEN_ITEMS),
      openItemOwner: clone(SEED_OPEN_ITEM_OWNER),
      postedPayments: new Map(),
      orderIdempotency: new Map(),
      nextOrderNumber: 4714,
      nextInquiryNumber: 10000807,
      nextQuotationNumber: 20000902,
      nextCustomerNumber: 1004,
      nextFiDocument: 1400000922,
    };

    for (const order of this.store.orders) {
      if (order.customerPoRef) {
        this.store.orderIdempotency.set(
          this.idempotencyKey(order.kunnr, order.customerPoRef),
          order.vbeln,
        );
      }
    }
  }

  // ---- infrastructure ---------------------------------------------------

  private async call<T>(fn: () => T): Promise<T> {
    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
    if (this.options.unavailable) {
      throw sapUnavailable("SAP system is not reachable (mock outage simulation)");
    }
    return fn();
  }

  private read<T>(data: T): SapRead<T> {
    return sapRead(data, "live", new Date(`${this.options.today}T09:42:00.000Z`));
  }

  private idempotencyKey(kunnr: string, poRef: string): string {
    return `${kunnr}::${poRef}`;
  }

  async health(): Promise<SapConnectionHealth> {
    return {
      reachable: !this.options.unavailable,
      driver: this.driver,
      circuit: this.options.unavailable ? "open" : "closed",
      checkedAt: new Date().toISOString(),
    };
  }

  // ---- customer master --------------------------------------------------

  async createCustomer(customer: CanonicalCustomer): Promise<CustomerCreateResult> {
    return this.call(() => {
      const duplicate = this.store.customers.find((c) => c.tax.gstin === customer.tax.gstin);
      if (duplicate) {
        // ECC would return BAPIRET2 E / F2 018 on a duplicate tax number.
        throw sapValidation(
          `A customer with GSTIN ${customer.tax.gstin} already exists (${duplicate.kunnr})`,
          "gstin",
          "F2/018",
        );
      }

      const kunnr = String(10001000 + this.store.nextCustomerNumber++).padStart(10, "0");
      const created: CanonicalCustomer = {
        ...clone(customer),
        kunnr,
        // SAP silently truncates to the dictionary length — mirror that so
        // the portal's own validation is what catches over-long input.
        legalEntityName: truncateToSapLength("legalEntityName", customer.legalEntityName),
        tradeName: customer.tradeName
          ? truncateToSapLength("tradeName", customer.tradeName)
          : undefined,
      };

      this.store.customers.push(created);
      this.store.shipTos.push({ kunnr, label: "Registered address", address: created.address });
      this.store.credit.push({
        kunnr,
        creditLimit: 0,
        utilized: 0,
        available: 0,
        blocked: false,
        currency: "INR",
      });

      return { kunnr, customer: created };
    });
  }

  async updateCustomer(kunnr: string, patch: CustomerPatch): Promise<CustomerUpdateResult> {
    return this.call(() => {
      const existing = this.requireCustomer(kunnr);

      // A patch, applied field by field: what the caller did not send stays
      // as SAP has it. `undefined` therefore means "leave alone" and never
      // "clear", which is what makes a portal edit safe to run against a
      // master somebody is also maintaining in XD02.
      const previousAddress = clone(existing.address);

      if (patch.tradeName !== undefined) {
        existing.tradeName = truncateToSapLength("tradeName", patch.tradeName);
      }
      if (patch.address) existing.address = clone(patch.address);
      if (patch.contact) existing.contact = clone(patch.contact);

      // A ship-to that *was* the billing address moves with it, as changing
      // KNA1 does in ECC; one the tenant maintains separately (a plant, a
      // warehouse) does not. A mock that moved all of them would hide the
      // difference, and one that moved none would hide the sync entirely.
      if (patch.address) {
        for (const shipTo of this.store.shipTos) {
          if (shipTo.kunnr !== kunnr) continue;
          if (JSON.stringify(shipTo.address) !== JSON.stringify(previousAddress)) continue;
          shipTo.address = clone(existing.address);
        }
      }

      return { kunnr, customer: clone(existing) };
    });
  }

  async getCustomer(kunnr: string): Promise<SapRead<CanonicalCustomer>> {
    return this.call(() => this.read(clone(this.requireCustomer(kunnr))));
  }

  async getShipToAddresses(kunnr: string): Promise<SapRead<ShipToAddress[]>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      return this.read(clone(this.store.shipTos.filter((s) => s.kunnr === kunnr)));
    });
  }

  async getCreditInfo(kunnr: string): Promise<SapRead<CreditInfo>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const credit = this.store.credit.find((c) => c.kunnr === kunnr);
      if (!credit) throw sapNotFound("Credit master", kunnr);
      // `available` is derived, never trusted from the source row.
      return this.read({ ...clone(credit), available: credit.creditLimit - credit.utilized });
    });
  }

  async getRebateAgreements(kunnr: string): Promise<SapRead<RebateAgreement[]>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      // An account with no agreement is not an error — most accounts have
      // none, and a 404 here would make the loyalty screen fail for them.
      return this.read(clone(this.store.rebates.filter((r) => r.kunnr === kunnr)));
    });
  }

  /** Every agreement in the tenant — the AP desk's settlement queue. */
  async getRebateRegister(): Promise<SapRead<RebateAgreement[]>> {
    return this.call(() => this.read(clone(this.store.rebates)));
  }

  private requireCustomer(kunnr: string): CanonicalCustomer {
    const customer = this.store.customers.find((c) => c.kunnr === kunnr);
    if (!customer) throw sapNotFound("Customer", kunnr);
    return customer;
  }

  // ---- catalogue --------------------------------------------------------

  async getMaterials(query: MaterialQuery = {}): Promise<SapRead<Page<Material>>> {
    return this.call(() => {
      const search = query.search?.trim().toLowerCase();
      let items = this.store.materials.filter((material) => {
        if (query.materialGroup && material.materialGroup !== query.materialGroup) return false;
        if (
          query.plant &&
          !this.store.stock.some((s) => s.material === material.material && s.plant === query.plant)
        ) {
          return false;
        }
        if (search) {
          const haystack = `${material.material} ${material.description}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

      const total = items.length;
      const offset = query.offset ?? 0;
      items = items.slice(offset, offset + (query.limit ?? total));
      return this.read({ items: clone(items), total });
    });
  }

  async getMaterial(material: string): Promise<SapRead<Material>> {
    return this.call(() => this.read(clone(this.requireMaterial(material))));
  }

  async getStock(material: string, plant?: string): Promise<SapRead<StockLevel[]>> {
    return this.call(() => {
      this.requireMaterial(material);
      const levels = this.store.stock.filter(
        (s) => s.material === material && (!plant || s.plant === plant),
      );
      return this.read(clone(levels));
    });
  }

  async getCustomerPrice(
    kunnr: string,
    material: string,
    quantity: number,
  ): Promise<SapRead<CustomerPrice>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const record = this.requireMaterial(material);
      return this.read(this.priceFor(kunnr, record, quantity));
    });
  }

  private requireMaterial(material: string): Material {
    const record = this.store.materials.find((m) => m.material === material);
    if (!record) throw sapNotFound("Material", material);
    return record;
  }

  private priceFor(kunnr: string, material: Material, quantity: number): CustomerPrice {
    const listPrice = SEED_LIST_PRICES[material.material];
    if (listPrice === undefined) {
      // No PR00 condition record -> SAP cannot price the item.
      throw sapValidation(
        `No valid price condition for material ${material.material}`,
        "material",
        "V1/302",
      );
    }

    const conditions = SEED_DISCOUNTS[kunnr];
    const discountPercent = conditions?.byMaterial?.[material.material] ?? conditions?.default ?? 0;

    return {
      material: material.material,
      kunnr,
      quantity,
      uom: material.uom,
      listPrice,
      netPrice: round2(listPrice * (1 - discountPercent / 100)),
      discountPercent,
      currency: "INR",
      conditionRecord: `00${material.material.replace(/\D/g, "").slice(0, 8)}`,
      ...SEED_PRICE_VALIDITY,
    };
  }

  // ---- inquiries & quotations -------------------------------------------

  async createInquiry(input: CreateInquiryInput): Promise<Inquiry> {
    return this.call(() => {
      this.requireCustomer(input.kunnr);
      if (input.lines.length === 0) {
        throw sapValidation("An inquiry must contain at least one item", "lines", "V1/555");
      }

      const vbeln = String(this.store.nextInquiryNumber++).padStart(10, "0");
      const inquiry: Inquiry = {
        vbeln,
        kunnr: input.kunnr,
        createdOn: this.options.today,
        requiredDeliveryDate: input.requiredDeliveryDate,
        validityDays: input.validityDays,
        notes: input.notes,
        status: "Open",
        lines: input.lines.map((line, index) => {
          const material = this.requireMaterial(line.material);
          if (line.quantity <= 0) {
            throw sapValidation(
              `Quantity must be greater than zero for ${line.material}`,
              "quantity",
              "V1/319",
            );
          }
          return {
            lineNo: (index + 1) * 10,
            material: material.material,
            description: material.description,
            quantity: line.quantity,
            uom: line.uom,
            // An inquiry carries no price: that is the question it is asking.
            netPrice: 0,
            netValue: 0,
          };
        }),
      };

      this.store.inquiries.push(inquiry);
      // The sales desk is given until this moment to answer by hand; past it
      // the mock answers for them (see `autoQuote`).
      this.store.autoQuoteDue.set(vbeln, Date.now() + this.options.autoQuoteAfterMs);

      return clone(inquiry);
    });
  }

  async getInquiries(kunnr: string): Promise<SapRead<Page<Inquiry>>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      this.autoQuote();
      const items = this.store.inquiries
        .filter((i) => i.kunnr === kunnr)
        .sort((a, b) => b.createdOn.localeCompare(a.createdOn));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  async getInquiry(vbeln: string): Promise<SapRead<Inquiry>> {
    return this.call(() => {
      this.autoQuote();
      const inquiry = this.store.inquiries.find((i) => i.vbeln === vbeln);
      if (!inquiry) throw sapNotFound("Inquiry", vbeln);
      return this.read(clone(inquiry));
    });
  }

  async getInquiryQueue(): Promise<SapRead<Page<Inquiry>>> {
    return this.call(() => {
      // Deliberately *not* auto-quoted: this is the sales desk's own queue,
      // and answering an inquiry the moment they look at it would leave the
      // workbench permanently empty.
      const items = this.store.inquiries
        .filter((i) => !i.quotation)
        .sort((a, b) => a.createdOn.localeCompare(b.createdOn));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  /**
   * The sales-side auto-quote docs/07 A4 asks for ("mock: sales-side
   * auto-quotes after a delay to make the flow demoable").
   *
   * Lazily materialised on read rather than scheduled with a timer: a timer in
   * an adapter fires in whatever process happened to construct it, survives no
   * restart, and keeps a handle alive in every test that ever raised an
   * inquiry. Asking "is it due?" when someone looks costs nothing and behaves
   * identically from the customer's side.
   */
  private autoQuote(): void {
    const now = Date.now();
    for (const [inquiryVbeln, due] of this.store.autoQuoteDue) {
      if (due > now) continue;
      this.store.autoQuoteDue.delete(inquiryVbeln);

      const inquiry = this.store.inquiries.find((i) => i.vbeln === inquiryVbeln);
      // A sales user who got there first (VA21 through the workbench) wins:
      // the auto-quote exists to keep a demo moving, not to overrule anybody.
      if (!inquiry || inquiry.quotation) continue;

      this.issueQuotation(inquiry, {
        validUntil: shiftDays(this.options.today, this.options.quotationValidityDays),
      });
    }
  }

  async createQuotation(input: CreateQuotationInput): Promise<Quotation> {
    return this.call(() => {
      const inquiry = this.store.inquiries.find((i) => i.vbeln === input.inquiryVbeln);
      if (!inquiry) throw sapNotFound("Inquiry", input.inquiryVbeln);
      if (inquiry.quotation) {
        // VA21 would create a second document; the portal refuses because a
        // customer with two live quotations for one inquiry has no way to
        // know which one the tenant means.
        throw sapValidation(
          `Inquiry ${inquiry.vbeln} has already been quoted (${inquiry.quotation})`,
          "inquiryVbeln",
          "V1/473",
        );
      }
      if (input.validUntil < this.options.today) {
        throw sapValidation(
          "A quotation cannot be issued with a validity date in the past",
          "validUntil",
          "V1/213",
        );
      }

      this.store.autoQuoteDue.delete(inquiry.vbeln);
      return clone(this.issueQuotation(inquiry, input));
    });
  }

  /**
   * VA21 against an inquiry, shared by the workbench and the auto-quote so
   * the two produce identical documents.
   *
   * Prices come from the customer's own condition records unless the sales
   * user overrode a line, and the tax split follows the same rule the seeded
   * invoices do — CGST+SGST when the customer's region matches the supplying
   * plant's, IGST when it doesn't. The portal never computes GST (docs/02 §5);
   * this is the mock standing in for SAP's pricing procedure.
   */
  private issueQuotation(inquiry: Inquiry, input: Omit<CreateQuotationInput, "inquiryVbeln">) {
    const overrides = new Map((input.lines ?? []).map((line) => [line.lineNo, line.netPrice]));

    let netValue = 0;
    const lines: SalesDocLine[] = inquiry.lines.map((line) => {
      const material = this.requireMaterial(line.material);
      const netPrice =
        overrides.get(line.lineNo) ??
        this.priceFor(inquiry.kunnr, material, line.quantity).netPrice;
      const lineValue = round2(netPrice * line.quantity);
      netValue += lineValue;
      return { ...clone(line), netPrice, netValue: lineValue };
    });

    netValue = round2(netValue);
    const tax = this.taxFor(inquiry.kunnr, netValue);
    const vbeln = String(this.store.nextQuotationNumber++).padStart(10, "0");

    const quotation: Quotation = {
      vbeln,
      kunnr: inquiry.kunnr,
      createdOn: this.options.today,
      validUntil: input.validUntil,
      inquiry: inquiry.vbeln,
      status: "Open",
      taxCode: "J1",
      lines,
      netValue,
      ...tax,
      grossValue: round2(netValue + tax.cgst + tax.sgst + tax.igst),
      currency: "INR",
    };

    this.store.quotations.push(quotation);
    // VBUK-GBSTK on the inquiry: fully referenced by the quotation.
    inquiry.quotation = vbeln;
    inquiry.status = "Closed";

    return quotation;
  }

  /**
   * The GST split, decided by place of supply (docs/03 Module 6): the seeded
   * plants are in state 27, so a customer in 27 gets CGST+SGST and everyone
   * else IGST. Rate is a flat 18% across the seeded material master.
   */
  private taxFor(kunnr: string, netValue: number): { cgst: number; sgst: number; igst: number } {
    const customer = this.requireCustomer(kunnr);
    const intraState = customer.address.region === SUPPLYING_REGION;
    const total = round2(netValue * 0.18);

    return intraState
      ? { cgst: round2(total / 2), sgst: round2(total / 2), igst: 0 }
      : { cgst: 0, sgst: 0, igst: total };
  }

  async getQuotations(kunnr: string): Promise<SapRead<Page<Quotation>>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      this.autoQuote();
      const items = this.store.quotations
        .filter((q) => q.kunnr === kunnr)
        .sort((a, b) => b.createdOn.localeCompare(a.createdOn));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  async getQuotation(vbeln: string): Promise<SapRead<Quotation>> {
    return this.call(() => this.read(clone(this.requireQuotation(vbeln))));
  }

  private requireQuotation(vbeln: string): Quotation {
    const quotation = this.store.quotations.find((q) => q.vbeln === vbeln);
    if (!quotation) throw sapNotFound("Quotation", vbeln);
    return quotation;
  }

  async requestQuotationRevision(vbeln: string, comment: string): Promise<Quotation> {
    return this.call(() => {
      const quotation = this.requireQuotation(vbeln);
      if (quotation.salesOrder) {
        throw sapValidation(
          `Quotation ${vbeln} has already been converted to order ${quotation.salesOrder}`,
          "vbeln",
          "V1/473",
        );
      }

      quotation.revisionRequests = [
        ...(quotation.revisionRequests ?? []),
        { requestedOn: this.options.today, comment },
      ];
      return clone(quotation);
    });
  }

  /**
   * VA01 with reference (copy control). The order is created through the same
   * path a direct order takes — same ATP, same credit run, same idempotency —
   * with the quotation's prices carried onto the lines, which is what "copy
   * control" means and why a converted order does not get re-priced.
   */
  async convertQuoteToOrder(input: ConvertQuotationInput): Promise<SalesOrderResult> {
    const quotation = await this.call(() => {
      const found = this.requireQuotation(input.quotationVbeln);
      if (found.salesOrder) {
        // Not an error the portal invents: SAP's copy control refuses a
        // second full reference, and a customer who double-clicks Accept must
        // get one order, not two.
        throw sapValidation(
          `Quotation ${found.vbeln} has already been converted to order ${found.salesOrder}`,
          "quotationVbeln",
          "V1/473",
        );
      }
      if (found.validUntil < this.options.today) {
        throw sapValidation(
          `Quotation ${found.vbeln} expired on ${found.validUntil}`,
          "quotationVbeln",
          "V1/212",
        );
      }
      return found;
    });

    const order = await this.createSalesOrder({
      kunnr: quotation.kunnr,
      customerPoRef: input.customerPoRef,
      requestedDeliveryDate:
        input.requestedDeliveryDate ??
        this.store.inquiries.find((i) => i.vbeln === quotation.inquiry)?.requiredDeliveryDate ??
        this.options.today,
      shipTo: input.shipTo,
      referenceQuotation: quotation.vbeln,
      lines: quotation.lines.map((line) => ({
        material: line.material,
        quantity: line.quantity,
        uom: line.uom,
        netPrice: line.netPrice,
      })),
    });

    quotation.salesOrder = order.vbeln;
    // VBUK-GBSTK: fully referenced by the sales order.
    quotation.status = "Closed";

    return order;
  }

  // ---- sales orders -----------------------------------------------------

  async simulateOrder(input: CreateSalesOrderInput): Promise<OrderSimulation> {
    return this.call(() => this.buildSimulation(input));
  }

  /**
   * ATP + credit preview. Confirms against seeded stock at the chosen (or
   * first stocked) plant: full stock -> confirmed on the requested date,
   * short stock -> partial confirmation dated by MARC-WEBAZ lead time.
   */
  private buildSimulation(input: CreateSalesOrderInput): OrderSimulation {
    this.requireCustomer(input.kunnr);
    if (input.lines.length === 0) {
      throw sapValidation("An order must contain at least one item", "lines", "V1/555");
    }

    let netValue = 0;
    const lines = input.lines.map((line, index) => {
      const material = this.requireMaterial(line.material);
      if (line.quantity <= 0) {
        throw sapValidation(
          `Quantity must be greater than zero for ${line.material}`,
          "quantity",
          "V1/319",
        );
      }
      if (line.quantity < material.minimumOrderQty) {
        throw sapValidation(
          `Minimum order quantity for ${material.material} is ${material.minimumOrderQty} ${material.uom}`,
          "quantity",
          "V1/337",
        );
      }

      const stock = this.stockFor(material.material);
      const confirmedQty = Math.min(line.quantity, stock?.quantity ?? 0);
      const price = line.netPrice ?? this.priceFor(input.kunnr, material, line.quantity).netPrice;
      netValue += round2(price * line.quantity);

      return {
        lineNo: (index + 1) * 10,
        material: material.material,
        requestedQty: line.quantity,
        confirmedQty,
        confirmedDate:
          confirmedQty >= line.quantity
            ? input.requestedDeliveryDate
            : shiftDays(this.options.today, stock?.leadTimeDays ?? 30),
        partial: confirmedQty < line.quantity,
      };
    });

    const credit = this.store.credit.find((c) => c.kunnr === input.kunnr);
    const headroom = credit
      ? credit.creditLimit * this.options.creditToleranceRatio - credit.utilized
      : 0;

    return {
      lines,
      netValue: round2(netValue),
      currency: "INR",
      creditBlockExpected: Boolean(credit?.blocked) || netValue > headroom,
    };
  }

  private stockFor(material: string, plant?: string): StockLevel | undefined {
    const levels = this.store.stock.filter(
      (s) => s.material === material && (!plant || s.plant === plant),
    );
    // Without an explicit plant SAP would run plant determination; the mock
    // picks the plant holding the most stock, which is the realistic outcome.
    return levels.sort((a, b) => b.quantity - a.quantity)[0];
  }

  async createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderResult> {
    return this.call(() => {
      // Idempotency: the same customer PO reference must never create two
      // sales orders, however many times the outbox worker retries.
      const key = input.customerPoRef
        ? this.idempotencyKey(input.kunnr, input.customerPoRef)
        : undefined;
      const existingVbeln = key ? this.store.orderIdempotency.get(key) : undefined;
      if (existingVbeln) {
        const existing = this.store.orders.find((o) => o.vbeln === existingVbeln)!;
        return this.toOrderResult(existing);
      }

      const simulation = this.buildSimulation(input);
      if (!this.store.shipTos.some((s) => s.kunnr === input.kunnr || s.kunnr === input.shipTo)) {
        throw sapValidation(
          `Ship-to party ${input.shipTo} is not assigned to this customer`,
          "shipTo",
          "V1/113",
        );
      }

      const vbeln = String(this.store.nextOrderNumber++).padStart(10, "0");
      const lines: SalesDocLine[] = simulation.lines.map((line) => {
        const material = this.requireMaterial(line.material);
        const inputLine = input.lines.find((l) => l.material === line.material)!;
        const netPrice =
          inputLine.netPrice ?? this.priceFor(input.kunnr, material, line.requestedQty).netPrice;
        return {
          lineNo: line.lineNo,
          material: line.material,
          description: material.description,
          quantity: line.requestedQty,
          uom: inputLine.uom,
          netPrice,
          netValue: round2(netPrice * line.requestedQty),
          plant: this.stockFor(line.material)?.plant ?? PLANTS[0],
          confirmedQty: simulation.creditBlockExpected ? 0 : line.confirmedQty,
          confirmedDate: line.confirmedDate,
        };
      });

      const order: OrderStatusView = {
        vbeln,
        kunnr: input.kunnr,
        createdOn: this.options.today,
        customerPoRef: input.customerPoRef,
        // VBUK-GBSTK is A (Open) on creation; CMGST reflects the credit run.
        orderStatus: "Open",
        creditStatus: simulation.creditBlockExpected ? "CreditHold" : "Confirmed",
        lines,
        netValue: simulation.netValue,
        currency: simulation.currency,
      };

      this.store.orders.push(order);
      if (key) this.store.orderIdempotency.set(key, vbeln);

      // A released order consumes credit exposure (KNKK-SKFOR) immediately.
      const credit = this.store.credit.find((c) => c.kunnr === input.kunnr);
      if (credit && order.creditStatus !== "CreditHold") {
        credit.utilized = round2(credit.utilized + order.netValue);
        credit.available = round2(credit.creditLimit - credit.utilized);
      }

      return this.toOrderResult(order);
    });
  }

  /**
   * VA02 rejection. SAP would set VBAP-ABGRU on every item and re-run the
   * status determination; the mock does the equivalent — the order goes to
   * `Closed` with nothing confirmed, and any credit exposure it consumed is
   * given back. An order that is not fully open cannot be withdrawn this
   * way, because by then a delivery document references it.
   */
  async cancelSalesOrder(vbeln: string, reason?: string): Promise<SalesOrderResult> {
    return this.call(() => {
      const order = this.store.orders.find((o) => o.vbeln === vbeln);
      if (!order) throw sapNotFound("Sales order", vbeln);

      if (order.orderStatus !== "Open") {
        throw sapValidation(
          `Sales order ${vbeln} can no longer be cancelled — it is already in processing`,
          "vbeln",
          "V4/219",
        );
      }

      const credit = this.store.credit.find((c) => c.kunnr === order.kunnr);
      if (credit && order.creditStatus !== "CreditHold") {
        credit.utilized = round2(credit.utilized - order.netValue);
        credit.available = round2(credit.creditLimit - credit.utilized);
      }

      order.orderStatus = "Closed";
      order.rejectionReason = reason;
      for (const line of order.lines) line.confirmedQty = 0;

      // The PO reference is released with the order: the customer may
      // legitimately re-raise the same PO after cancelling it.
      if (order.customerPoRef) {
        this.store.orderIdempotency.delete(this.idempotencyKey(order.kunnr, order.customerPoRef));
      }

      return this.toOrderResult(order);
    });
  }

  private toOrderResult(order: OrderStatusView): SalesOrderResult {
    return {
      vbeln: order.vbeln,
      orderStatus: order.orderStatus,
      creditStatus: order.creditStatus,
      lines: clone(order.lines),
      netValue: order.netValue,
      currency: order.currency,
    };
  }

  async getOrderStatus(vbeln: string): Promise<SapRead<OrderStatusView>> {
    return this.call(() => {
      const order = this.store.orders.find((o) => o.vbeln === vbeln);
      if (!order) throw sapNotFound("Sales order", vbeln);
      return this.read(clone(order));
    });
  }

  async getOrders(kunnr: string): Promise<SapRead<Page<OrderStatusView>>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const items = this.store.orders
        .filter((o) => o.kunnr === kunnr)
        .sort((a, b) => b.createdOn.localeCompare(a.createdOn));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  /**
   * Orders SAP is holding on credit, tenant-wide (doc 05 §8's release queue).
   *
   * Derived from the stored orders' CMGST rather than from a seeded list, so
   * an order the mock credit-checks into a hold during a demo turns up here
   * without anybody re-seeding anything.
   */
  async getCreditBlockedOrders(): Promise<SapRead<Page<OrderStatusView>>> {
    return this.call(() => {
      const items = this.store.orders
        .filter((o) => o.creditStatus === "CreditHold")
        .sort((a, b) => a.createdOn.localeCompare(b.createdOn));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  // ---- delivery ---------------------------------------------------------

  async getDeliveries(kunnr: string): Promise<SapRead<Page<Delivery>>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const items = this.store.deliveries
        .filter((d) => d.kunnr === kunnr)
        .sort((a, b) =>
          (b.actualGoodsIssue ?? b.plannedGoodsIssue ?? "").localeCompare(
            a.actualGoodsIssue ?? a.plannedGoodsIssue ?? "",
          ),
        );
      return this.read({ items: clone(items), total: items.length });
    });
  }

  async getDeliveriesForOrder(vbeln: string): Promise<SapRead<Delivery[]>> {
    return this.call(() => {
      const deliveries = this.store.deliveries.filter((d) => d.salesOrder === vbeln);
      return this.read(clone(deliveries));
    });
  }

  async getDelivery(deliveryVbeln: string): Promise<SapRead<Delivery>> {
    return this.call(() => {
      const delivery = this.store.deliveries.find((d) => d.vbeln === deliveryVbeln);
      if (!delivery) throw sapNotFound("Delivery", deliveryVbeln);
      return this.read(clone(delivery));
    });
  }

  /**
   * VLPOD. SAP's own behaviour, simulated: the receipt sets LIKP-KOQUK and
   * moves WBSTK to complete, and a quantity difference is recorded on the
   * line rather than rejected — a short delivery is a fact to be reported,
   * not an invalid input.
   *
   * Re-confirming is refused, because SAP refuses it: once a POD exists the
   * document is closed, and a portal that let the customer resubmit would be
   * offering a button the real driver will reject in Phase 7.
   */
  async confirmPod(input: ConfirmPodInput): Promise<ConfirmPodResult> {
    return this.call(() => {
      const delivery = this.store.deliveries.find((d) => d.vbeln === input.deliveryVbeln);
      if (!delivery) throw sapNotFound("Delivery", input.deliveryVbeln);

      if (delivery.podConfirmed) {
        throw sapValidation(
          `Delivery ${input.deliveryVbeln} already has a proof of delivery`,
          "deliveryVbeln",
          "VL/431",
        );
      }
      if (!delivery.actualGoodsIssue) {
        throw sapValidation(
          `Delivery ${input.deliveryVbeln} has not been despatched yet`,
          "deliveryVbeln",
          "VL/307",
        );
      }

      let discrepancy = false;
      for (const line of input.lines) {
        const item = delivery.lines.find((l) => l.lineNo === line.lineNo);
        if (!item) throw sapNotFound("Delivery item", String(line.lineNo));
        // LIPS-LFIMG is overwritten with what was actually received, which is
        // what VLPOD does — the dispatched quantity survives on the billing
        // document, not here.
        if (round3(line.receivedQty) !== round3(item.quantity)) discrepancy = true;
        item.confirmedQty = round3(line.receivedQty);
      }

      delivery.podConfirmed = true;
      delivery.podReceiptDate = input.receiptDate;
      delivery.status = "Delivered";

      return {
        deliveryVbeln: delivery.vbeln,
        status: delivery.status,
        discrepancy,
      };
    });
  }

  // ---- billing ----------------------------------------------------------

  async getInvoices(kunnr: string): Promise<SapRead<Page<Invoice>>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const items = this.store.invoices
        .filter((i) => i.kunnr === kunnr)
        .sort((a, b) => b.billingDate.localeCompare(a.billingDate));
      return this.read({ items: clone(items), total: items.length });
    });
  }

  async getInvoice(vbeln: string): Promise<SapRead<Invoice>> {
    return this.call(() => {
      const invoice = this.store.invoices.find((i) => i.vbeln === vbeln);
      if (!invoice) throw sapNotFound("Invoice", vbeln);
      return this.read(clone(invoice));
    });
  }

  /** Every billing document in the tenant — the AP/AR desk registers. */
  async getBillingRegister(): Promise<SapRead<Page<Invoice>>> {
    return this.call(() => {
      const items = [...this.store.invoices].sort((a, b) =>
        b.billingDate.localeCompare(a.billingDate),
      );
      return this.read({ items: clone(items), total: items.length });
    });
  }

  async getInvoicePdf(vbeln: string): Promise<string> {
    return this.call(() => {
      const invoice = this.store.invoices.find((i) => i.vbeln === vbeln);
      if (!invoice) throw sapNotFound("Invoice", vbeln);
      return invoice.pdfUrl ?? `/mock/sap/billing/${vbeln}.pdf`;
    });
  }

  // ---- accounts receivable ---------------------------------------------

  async getOpenItems(kunnr: string): Promise<SapRead<OpenItem[]>> {
    return this.call(() => {
      this.requireCustomer(kunnr);
      const items = this.store.openItems.filter(
        (item) => this.store.openItemOwner[item.documentNumber] === kunnr,
      );
      return this.read(clone(items));
    });
  }

  /**
   * The tenant's whole AR ledger, each item carrying its account.
   *
   * The owner comes off the same `openItemOwner` map the customer read filters
   * on, so the desk and the customer cannot disagree about who owes what — a
   * separate seed of ownership would be a second answer to the question this
   * mock exists to make one of.
   */
  async getOpenItemsLedger(): Promise<SapRead<LedgerOpenItem[]>> {
    return this.call(() => {
      const items = this.store.openItems.flatMap((item): LedgerOpenItem[] => {
        const kunnr = this.store.openItemOwner[item.documentNumber];
        // An item with no owner is dropped rather than defaulted: a
        // collections queue that attributed a document to the wrong account
        // would be worse than one that is short a row.
        return kunnr ? [{ ...clone(item), kunnr }] : [];
      });
      return this.read(items);
    });
  }

  async postIncomingPayment(input: IncomingPaymentInput): Promise<IncomingPaymentResult> {
    return this.call(() => {
      // Gateway webhooks are at-least-once: the same reference must post once.
      const already = this.store.postedPayments.get(input.gatewayReference);
      if (already) return clone(already);

      this.requireCustomer(input.kunnr);
      const allocated = round2(input.allocations.reduce((sum, a) => sum + a.amount, 0));
      if (allocated > round2(input.amount)) {
        throw sapValidation("Allocated amount exceeds the payment amount", "allocations", "F5/263");
      }

      const clearedItems: string[] = [];
      const residualItems: string[] = [];
      const documentNumber = String(this.store.nextFiDocument++);

      for (const allocation of input.allocations) {
        const item = this.store.openItems.find(
          (i) => i.documentNumber === allocation.documentNumber,
        );
        if (!item) throw sapNotFound("Open item", allocation.documentNumber);
        if (this.store.openItemOwner[item.documentNumber] !== input.kunnr) {
          // Never reveal that another customer's document exists.
          throw sapNotFound("Open item", allocation.documentNumber);
        }
        if (allocation.amount > item.openAmount) {
          throw sapValidation(
            `Amount exceeds the open balance of document ${item.documentNumber}`,
            "allocations",
            "F5/263",
          );
        }

        item.openAmount = round2(item.openAmount - allocation.amount);
        if (item.openAmount === 0) {
          item.status = "Cleared";
          item.clearingDocument = documentNumber;
          clearedItems.push(item.documentNumber);
        } else {
          // Partial payment leaves a residual item still open (docs/02 §6).
          residualItems.push(item.documentNumber);
        }
      }

      const result: IncomingPaymentResult = { documentNumber, clearedItems, residualItems };
      this.store.postedPayments.set(input.gatewayReference, result);

      this.store.openItems.push({
        documentNumber,
        documentType: "DZ",
        postingDate: this.options.today,
        dueDate: this.options.today,
        amount: -round2(input.amount),
        openAmount: 0,
        currency: input.currency,
        status: "Cleared",
        clearingDocument: documentNumber,
      });
      this.store.openItemOwner[documentNumber] = input.kunnr;

      return clone(result);
    });
  }
}
