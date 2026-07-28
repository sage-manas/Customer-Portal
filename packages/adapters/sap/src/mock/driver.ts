import type {
  CanonicalCustomer,
  CreateSalesOrderInput,
  CreditInfo,
  CustomerCreateResult,
  CustomerPrice,
  Delivery,
  IncomingPaymentInput,
  IncomingPaymentResult,
  Invoice,
  Material,
  MaterialQuery,
  OpenItem,
  OrderSimulation,
  OrderStatusView,
  Page,
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
  SEED_INVOICES,
  SEED_LIST_PRICES,
  SEED_MATERIALS,
  SEED_OPEN_ITEMS,
  SEED_OPEN_ITEM_OWNER,
  SEED_ORDERS,
  SEED_PRICE_VALIDITY,
  SEED_SHIP_TOS,
  SEED_STOCK,
  SEED_TODAY,
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
}

interface MockStore {
  customers: CanonicalCustomer[];
  shipTos: ShipToAddress[];
  credit: CreditInfo[];
  materials: Material[];
  stock: StockLevel[];
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
    };

    this.store = {
      customers: clone(SEED_CUSTOMERS),
      shipTos: clone(SEED_SHIP_TOS),
      credit: clone(SEED_CREDIT),
      materials: clone(SEED_MATERIALS),
      stock: clone(SEED_STOCK),
      orders: clone(SEED_ORDERS),
      deliveries: clone(SEED_DELIVERIES),
      invoices: clone(SEED_INVOICES),
      openItems: clone(SEED_OPEN_ITEMS),
      openItemOwner: clone(SEED_OPEN_ITEM_OWNER),
      postedPayments: new Map(),
      orderIdempotency: new Map(),
      nextOrderNumber: 4714,
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

  // ---- delivery ---------------------------------------------------------

  async getDeliveries(vbeln: string): Promise<SapRead<Delivery[]>> {
    return this.call(() => {
      const deliveries = this.store.deliveries.filter((d) => d.salesOrder === vbeln);
      return this.read(clone(deliveries));
    });
  }

  async getDeliveryDetail(deliveryVbeln: string): Promise<SapRead<Delivery>> {
    return this.call(() => {
      const delivery = this.store.deliveries.find((d) => d.vbeln === deliveryVbeln);
      if (!delivery) throw sapNotFound("Delivery", deliveryVbeln);
      return this.read(clone(delivery));
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
