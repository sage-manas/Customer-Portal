import type {
  CanonicalCustomer,
  CreditInfo,
  CustomerPrice,
  Delivery,
  Inquiry,
  Invoice,
  Material,
  OpenItem,
  OrderStatusView,
  Quotation,
  ShipToAddress,
  StockLevel,
} from "@cc/domain";

/**
 * Seeded SAP dataset for the mock driver.
 *
 * This is deliberately *realistic*, not minimal: an Indian manufacturer's
 * material master with sensible MATNR/MATKL/MEINS, three sold-to customers
 * in different states (so intra-state CGST+SGST vs inter-state IGST both
 * occur), customer-specific pricing conditions, an order in credit hold,
 * a part-delivered order, open and overdue AR items. Every downstream
 * phase can build its module against data that already exercises the
 * interesting states (docs/06: "full simulation with realistic seeded
 * data so nothing ever blocks on SAP").
 *
 * Values are frozen relative to `SEED_TODAY` so tests are deterministic;
 * `MockSapAdapter` deep-clones this on construction and mutates only its
 * own copy.
 */

/** Anchor date for all seeded documents. Dates below are ISO (docs/05 §11). */
export const SEED_TODAY = "2026-07-26";

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const PLANTS = ["1000", "2000"] as const;

/**
 * T005S region of the supplying plants. Place of supply is decided against
 * this (docs/03 Module 6): a customer in 27 gets CGST+SGST, everyone else
 * IGST — which is how the seeded invoices below are already split, and how
 * the mock prices a quotation's tax.
 */
export const SUPPLYING_REGION = "27";

/** T005S region codes used below: 27 Maharashtra, 29 Karnataka, 07 Delhi. */
export const SEED_MATERIALS: Material[] = [
  {
    material: "MAT-10001",
    description: "Hydraulic Pump HP-200",
    materialGroup: "PUMPS",
    uom: "EA",
    minimumOrderQty: 1,
  },
  {
    material: "MAT-10002",
    description: "Hydraulic Pump HP-400 Heavy Duty",
    materialGroup: "PUMPS",
    uom: "EA",
    minimumOrderQty: 1,
  },
  {
    material: "MAT-10003",
    description: "Control Valve CV-50 Brass",
    materialGroup: "VALVES",
    uom: "EA",
    minimumOrderQty: 5,
  },
  {
    material: "MAT-10004",
    description: "Control Valve CV-80 SS316",
    materialGroup: "VALVES",
    uom: "EA",
    minimumOrderQty: 5,
  },
  {
    material: "MAT-20001",
    description: "Seamless Steel Pipe 2in Sch40",
    materialGroup: "PIPES",
    uom: "M",
    minimumOrderQty: 50,
  },
  {
    material: "MAT-20002",
    description: "Seamless Steel Pipe 4in Sch40",
    materialGroup: "PIPES",
    uom: "M",
    minimumOrderQty: 50,
  },
  {
    material: "MAT-30001",
    description: "Nitrile Gasket Set 150mm",
    materialGroup: "SEALS",
    uom: "SET",
    minimumOrderQty: 10,
  },
  {
    material: "MAT-30002",
    description: "PTFE Gasket Set 200mm",
    materialGroup: "SEALS",
    uom: "SET",
    minimumOrderQty: 10,
  },
  {
    material: "MAT-40001",
    description: "Industrial Lubricant Grade 68",
    materialGroup: "FLUIDS",
    uom: "L",
    minimumOrderQty: 20,
  },
  {
    material: "MAT-40002",
    description: "Hydraulic Oil ISO VG 46",
    materialGroup: "FLUIDS",
    uom: "L",
    minimumOrderQty: 20,
  },
  {
    material: "MAT-50001",
    description: "Pressure Gauge 0-16 bar",
    materialGroup: "INSTR",
    uom: "EA",
    minimumOrderQty: 2,
  },
  {
    material: "MAT-50002",
    description: "Digital Flow Meter DN50",
    materialGroup: "INSTR",
    uom: "EA",
    minimumOrderQty: 1,
  },
];

/** MARD-LABST per material/plant. Deliberately includes out-of-stock. */
export const SEED_STOCK: StockLevel[] = [
  { material: "MAT-10001", plant: "1000", quantity: 145, uom: "EA", leadTimeDays: 3 },
  { material: "MAT-10001", plant: "2000", quantity: 32, uom: "EA", leadTimeDays: 5 },
  { material: "MAT-10002", plant: "1000", quantity: 8, uom: "EA", leadTimeDays: 10 },
  { material: "MAT-10003", plant: "1000", quantity: 620, uom: "EA", leadTimeDays: 2 },
  { material: "MAT-10004", plant: "2000", quantity: 0, uom: "EA", leadTimeDays: 21 },
  { material: "MAT-20001", plant: "1000", quantity: 4800, uom: "M", leadTimeDays: 4 },
  { material: "MAT-20002", plant: "1000", quantity: 1250, uom: "M", leadTimeDays: 4 },
  { material: "MAT-20002", plant: "2000", quantity: 300, uom: "M", leadTimeDays: 7 },
  { material: "MAT-30001", plant: "1000", quantity: 940, uom: "SET", leadTimeDays: 1 },
  { material: "MAT-30002", plant: "1000", quantity: 210, uom: "SET", leadTimeDays: 3 },
  { material: "MAT-40001", plant: "2000", quantity: 7600, uom: "L", leadTimeDays: 2 },
  { material: "MAT-40002", plant: "2000", quantity: 5400, uom: "L", leadTimeDays: 2 },
  { material: "MAT-50001", plant: "1000", quantity: 88, uom: "EA", leadTimeDays: 6 },
  { material: "MAT-50002", plant: "1000", quantity: 14, uom: "EA", leadTimeDays: 14 },
];

/** KONP-KBETR, condition PR00 — the list price before customer conditions. */
export const SEED_LIST_PRICES: Record<string, number> = {
  "MAT-10001": 48500,
  "MAT-10002": 92750,
  "MAT-10003": 3200,
  "MAT-10004": 7450,
  "MAT-20001": 640,
  "MAT-20002": 1180,
  "MAT-30001": 890,
  "MAT-30002": 1640,
  "MAT-40001": 310,
  "MAT-40002": 285,
  "MAT-50001": 2450,
  "MAT-50002": 18900,
};

/**
 * Customer-specific discount conditions (K007). Keyed by KUNNR; a material
 * key overrides the customer's `default` rate.
 */
export const SEED_DISCOUNTS: Record<
  string,
  { default: number; byMaterial?: Record<string, number> }
> = {
  "0010001001": { default: 8, byMaterial: { "MAT-10001": 12.5, "MAT-10002": 12.5 } },
  "0010001002": { default: 5 },
  "0010001003": { default: 0, byMaterial: { "MAT-20001": 3 } },
};

export const SEED_PRICE_VALIDITY: Pick<CustomerPrice, "validFrom" | "validTo"> = {
  validFrom: "2026-04-01",
  validTo: "2027-03-31",
};

export const SEED_CUSTOMERS: CanonicalCustomer[] = [
  {
    kunnr: "0010001001",
    legalEntityName: "Sharma Industrial Supplies Pvt Ltd",
    tradeName: "Sharma Industrials",
    customerType: "Z001",
    address: {
      street: "Plot 42, MIDC Industrial Area",
      city: "Pune",
      region: "27",
      postalCode: "411018",
      country: "IN",
    },
    contact: {
      contactPerson: "Rohit Sharma",
      email: "rohit@sharmaindustrials.example",
      phone: "+912041234567",
    },
    tax: {
      pan: "AABCS1429P",
      gstin: "27AABCS1429P1ZK",
      gstRegistrationType: "01",
      cin: "U29299MH2011PTC221345",
    },
    salesOrg: "1000",
    distributionChannel: "10",
    paymentTerms: "NT30",
  },
  {
    kunnr: "0010001002",
    legalEntityName: "Deccan Fabricators Limited",
    customerType: "Z002",
    address: {
      street: "18 Peenya Industrial Estate",
      city: "Bengaluru",
      region: "29",
      postalCode: "560058",
      country: "IN",
    },
    contact: {
      contactPerson: "Anitha Rao",
      email: "anitha.rao@deccanfab.example",
      phone: "+918028765432",
    },
    tax: { pan: "AAECD8821L", gstin: "29AAECD8821L1Z9", gstRegistrationType: "01" },
    salesOrg: "1000",
    distributionChannel: "10",
    paymentTerms: "NT45",
  },
  {
    kunnr: "0010001003",
    legalEntityName: "Kapoor Engineering Works",
    customerType: "Z001",
    address: {
      street: "C-14 Okhla Phase II",
      city: "New Delhi",
      region: "07",
      postalCode: "110020",
      country: "IN",
    },
    contact: {
      contactPerson: "Vikram Kapoor",
      email: "vikram@kapoorengg.example",
      phone: "+911126381122",
    },
    tax: { pan: "AAFCK3310R", gstin: "07AAFCK3310R1ZM", gstRegistrationType: "01" },
    salesOrg: "1000",
    distributionChannel: "20",
    paymentTerms: "NT15",
  },
];

export const SEED_SHIP_TOS: ShipToAddress[] = [
  {
    kunnr: "0010001001",
    label: "Pune Works (default)",
    address: SEED_CUSTOMERS[0]!.address,
  },
  {
    kunnr: "0010001001",
    label: "Chakan Warehouse",
    address: {
      street: "Gat 210, Chakan MIDC Phase III",
      city: "Chakan",
      region: "27",
      postalCode: "410501",
      country: "IN",
    },
  },
  { kunnr: "0010001002", label: "Peenya Plant", address: SEED_CUSTOMERS[1]!.address },
  { kunnr: "0010001003", label: "Okhla Unit", address: SEED_CUSTOMERS[2]!.address },
];

/**
 * KNKK. 0010001002 sits above 95% utilisation so the credit-hold path and
 * the ">95% danger" dashboard state (docs/05 §7.9) are exercisable.
 */
export const SEED_CREDIT: CreditInfo[] = [
  {
    kunnr: "0010001001",
    creditLimit: 5000000,
    utilized: 1842500,
    available: 3157500,
    blocked: false,
    currency: "INR",
  },
  {
    kunnr: "0010001002",
    creditLimit: 2000000,
    utilized: 1965000,
    available: 35000,
    blocked: false,
    currency: "INR",
  },
  {
    kunnr: "0010001003",
    creditLimit: 750000,
    utilized: 812000,
    available: -62000,
    blocked: true,
    currency: "INR",
  },
];

/**
 * VBAK AUART=IN. Two inquiries per the states Module 3 has to render: one
 * still waiting on the sales desk (which is also what the admin workbench's
 * queue is seeded from), and one that has already been answered, so the
 * "Quotation received" list state exists in a fresh demo.
 */
export const SEED_INQUIRIES: Inquiry[] = [
  {
    vbeln: "0010000801",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -1),
    requiredDeliveryDate: shiftDays(SEED_TODAY, 21),
    validityDays: 30,
    notes: "Please quote for the annual maintenance shutdown. Delivery to Chakan.",
    status: "Open",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10003",
        description: "Control Valve CV-50 Brass",
        quantity: 40,
        uom: "EA",
        netPrice: 0,
        netValue: 0,
      },
      {
        lineNo: 20,
        material: "MAT-30002",
        description: "PTFE Gasket Set 200mm",
        quantity: 60,
        uom: "SET",
        netPrice: 0,
        netValue: 0,
      },
    ],
  },
  {
    vbeln: "0010000795",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -9),
    requiredDeliveryDate: shiftDays(SEED_TODAY, 14),
    validityDays: 30,
    status: "Closed",
    quotation: "0020000901",
    lines: [
      {
        lineNo: 10,
        material: "MAT-20001",
        description: "Seamless Steel Pipe 2in Sch40",
        quantity: 1200,
        uom: "M",
        netPrice: 0,
        netValue: 0,
      },
    ],
  },
  {
    // A second tenant customer's inquiry, so the workbench queue has more than
    // one account in it and the cross-customer 404 has something to fail on.
    vbeln: "0010000806",
    kunnr: "0010001002",
    createdOn: shiftDays(SEED_TODAY, -2),
    requiredDeliveryDate: shiftDays(SEED_TODAY, 30),
    status: "Open",
    lines: [
      {
        lineNo: 10,
        material: "MAT-50002",
        description: "Digital Flow Meter DN50",
        quantity: 4,
        uom: "EA",
        netPrice: 0,
        netValue: 0,
      },
    ],
  },
];

/**
 * VBAK AUART=AG, with tax as SAP would have calculated it (state 27 supplying
 * plant to a state-27 customer -> CGST+SGST). Three of them, because the
 * quotation screen's interesting states are all about *time*: one comfortably
 * live, one inside the 72-hour warning window, and one that lapsed — which is
 * the only way the "Request revalidation" path is reachable in a demo.
 */
export const SEED_QUOTATIONS: Quotation[] = [
  {
    vbeln: "0020000901",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -7),
    validUntil: shiftDays(SEED_TODAY, 23),
    inquiry: "0010000795",
    status: "Open",
    taxCode: "J1",
    netValue: 745200,
    cgst: 67068,
    sgst: 67068,
    igst: 0,
    grossValue: 879336,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-20001",
        description: "Seamless Steel Pipe 2in Sch40",
        quantity: 1200,
        uom: "M",
        netPrice: 621,
        netValue: 745200,
      },
    ],
  },
  {
    vbeln: "0020000884",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -25),
    // Inside the 72-hour warning window: the countdown chip goes amber.
    validUntil: shiftDays(SEED_TODAY, 1),
    status: "Open",
    taxCode: "J1",
    netValue: 96052,
    cgst: 8644.68,
    sgst: 8644.68,
    igst: 0,
    grossValue: 113341.36,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-50001",
        description: "Pressure Gauge 0-16 bar",
        quantity: 44,
        uom: "EA",
        netPrice: 2183,
        netValue: 96052,
      },
    ],
  },
  {
    vbeln: "0020000860",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -60),
    validUntil: shiftDays(SEED_TODAY, -12),
    status: "Open",
    taxCode: "J1",
    netValue: 425000,
    cgst: 38250,
    sgst: 38250,
    igst: 0,
    grossValue: 501500,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 10,
        uom: "EA",
        netPrice: 42500,
        netValue: 425000,
      },
    ],
  },
];

export const SEED_ORDERS: OrderStatusView[] = [
  {
    vbeln: "0000004711",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -21),
    customerPoRef: "PO-SH-8841",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 582000,
    currency: "INR",
    confirmationPdfUrl: "/mock/sap/output/BA00/0000004711.pdf",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 12,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 509250,
        plant: "1000",
        confirmedQty: 12,
        confirmedDate: shiftDays(SEED_TODAY, -14),
      },
      {
        lineNo: 20,
        material: "MAT-30001",
        description: "Nitrile Gasket Set 150mm",
        quantity: 90,
        uom: "SET",
        netPrice: 818.8,
        netValue: 73692,
        plant: "1000",
        confirmedQty: 90,
        confirmedDate: shiftDays(SEED_TODAY, -14),
      },
    ],
  },
  {
    vbeln: "0000004712",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -6),
    customerPoRef: "PO-SH-8902",
    orderStatus: "PartiallyDelivered",
    creditStatus: "Confirmed",
    netValue: 236000,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-20002",
        description: "Seamless Steel Pipe 4in Sch40",
        quantity: 200,
        uom: "M",
        netPrice: 1085.6,
        netValue: 217120,
        plant: "1000",
        confirmedQty: 150,
        confirmedDate: shiftDays(SEED_TODAY, 2),
      },
      {
        lineNo: 20,
        material: "MAT-50001",
        description: "Pressure Gauge 0-16 bar",
        quantity: 8,
        uom: "EA",
        netPrice: 2254,
        netValue: 18032,
        plant: "1000",
        confirmedQty: 8,
        confirmedDate: shiftDays(SEED_TODAY, -1),
      },
    ],
  },
  {
    vbeln: "0000004713",
    kunnr: "0010001002",
    createdOn: shiftDays(SEED_TODAY, -2),
    customerPoRef: "DF/2026/337",
    // Credit exposure exceeded on submit -> VBUK-CMGST = B.
    orderStatus: "Open",
    creditStatus: "CreditHold",
    netValue: 445000,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10002",
        description: "Hydraulic Pump HP-400 Heavy Duty",
        quantity: 5,
        uom: "EA",
        netPrice: 88112.5,
        netValue: 440562.5,
        plant: "1000",
        confirmedQty: 0,
        confirmedDate: shiftDays(SEED_TODAY, 21),
      },
    ],
  },
];

/**
 * LIKP/LIPS, linked to the seeded sales orders above. Between them the three
 * rows cover every state the delivery screens have to render: one signed for
 * (POD already posted), one in transit (the POD happy path), and one still in
 * the warehouse, which is the case where the portal must *not* offer a
 * Confirm Receipt button.
 */
export const SEED_DELIVERIES: Delivery[] = [
  {
    vbeln: "0080001901",
    salesOrder: "0000004711",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -14),
    actualGoodsIssue: shiftDays(SEED_TODAY, -14),
    carrier: "BLUEDART",
    trackingNumber: "BD48291733IN",
    ewayBillNumber: "291004718822",
    // The customer signed for this one, which is what let VF01 bill it.
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -13),
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        quantity: 12,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 509250,
      },
      {
        lineNo: 20,
        material: "MAT-30001",
        quantity: 90,
        uom: "SET",
        netPrice: 818.8,
        netValue: 73692,
      },
    ],
  },
  {
    vbeln: "0080001947",
    salesOrder: "0000004712",
    kunnr: "0010001001",
    status: "InTransit",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -2),
    actualGoodsIssue: shiftDays(SEED_TODAY, -2),
    carrier: "VRL",
    trackingNumber: "VRL7781209",
    ewayBillNumber: "291004901133",
    lines: [
      {
        lineNo: 10,
        material: "MAT-20002",
        quantity: 150,
        uom: "M",
        netPrice: 1085.6,
        netValue: 162840,
      },
    ],
  },
  {
    // The balance of order 4712 (200 M ordered, 150 shipped above). Picked and
    // packed but not yet issued, so it has no AWB, no e-way bill and — the
    // point of seeding it — nothing a customer may sign for yet.
    vbeln: "0080001960",
    salesOrder: "0000004712",
    kunnr: "0010001001",
    status: "Packed",
    plannedGoodsIssue: shiftDays(SEED_TODAY, 3),
    lines: [
      {
        lineNo: 10,
        material: "MAT-20002",
        quantity: 50,
        uom: "M",
        netPrice: 1085.6,
        netValue: 54280,
      },
    ],
  },
];

/**
 * VBRK/VBRP + tax conditions. Customer 0010001001 is in state 27 like the
 * supplying plant -> CGST+SGST; 0010001002 (state 29) -> IGST. The portal
 * never computes this (docs/02 §5) — it is seeded here as SAP would return it.
 */
export const SEED_INVOICES: Invoice[] = [
  {
    vbeln: "0090002211",
    billingDate: shiftDays(SEED_TODAY, -13),
    reference: "0080001901",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 582942,
    cgst: 52464.78,
    sgst: 52464.78,
    igst: 0,
    grossAmount: 687871.56,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, 17),
    status: "Open",
    irn: "a5f2c1d9e8b7a6f5c4d3e2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1",
    pdfUrl: "/mock/sap/billing/0090002211.pdf",
  },
  {
    vbeln: "0090002190",
    billingDate: shiftDays(SEED_TODAY, -58),
    reference: "0080001855",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 121400,
    cgst: 10926,
    sgst: 10926,
    igst: 0,
    grossAmount: 143252,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -28),
    status: "Overdue",
    irn: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
    pdfUrl: "/mock/sap/billing/0090002190.pdf",
  },
  {
    vbeln: "0090002205",
    billingDate: shiftDays(SEED_TODAY, -30),
    reference: "0080001880",
    kunnr: "0010001002",
    billingType: "F2",
    taxableAmount: 964000,
    cgst: 0,
    sgst: 0,
    igst: 173520,
    grossAmount: 1137520,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, 15),
    status: "Open",
    irn: "c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8",
    pdfUrl: "/mock/sap/billing/0090002205.pdf",
  },
  {
    vbeln: "0090002140",
    billingDate: shiftDays(SEED_TODAY, -95),
    reference: "0080001790",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 74500,
    cgst: 6705,
    sgst: 6705,
    igst: 0,
    grossAmount: 87910,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -65),
    status: "Paid",
    pdfUrl: "/mock/sap/billing/0090002140.pdf",
  },
  /**
   * A credit note (VBRK-FKART G2) against the overdue invoice above — short
   * delivery, reason code 003. Screen 6.2 has a tab for these, and without a
   * seeded one the whole tab would be permanently empty in every demo. It
   * carries a negative FI posting, so the statement's running balance and the
   * outstanding total both have to cope with a credit.
   */
  {
    vbeln: "0090002250",
    billingDate: shiftDays(SEED_TODAY, -20),
    reference: "0090002190",
    kunnr: "0010001001",
    billingType: "G2",
    reasonCode: "003",
    taxableAmount: -12140,
    cgst: -1092.6,
    sgst: -1092.6,
    igst: 0,
    grossAmount: -14325.2,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -20),
    status: "Cleared",
    pdfUrl: "/mock/sap/billing/0090002250.pdf",
  },
];

/** BSID/BSAD. Mirrors the invoices above plus one cleared payment (DZ). */
export const SEED_OPEN_ITEMS: OpenItem[] = [
  {
    documentNumber: "0090002211",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -13),
    dueDate: shiftDays(SEED_TODAY, 17),
    amount: 687871.56,
    openAmount: 687871.56,
    currency: "INR",
    status: "Open",
  },
  {
    documentNumber: "0090002190",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -58),
    dueDate: shiftDays(SEED_TODAY, -28),
    amount: 143252,
    openAmount: 143252,
    currency: "INR",
    status: "Overdue",
  },
  {
    documentNumber: "0090002205",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -30),
    dueDate: shiftDays(SEED_TODAY, 15),
    amount: 1137520,
    openAmount: 1137520,
    currency: "INR",
    status: "Open",
  },
  {
    documentNumber: "0090002140",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -95),
    dueDate: shiftDays(SEED_TODAY, -65),
    amount: 87910,
    openAmount: 0,
    currency: "INR",
    status: "Cleared",
    clearingDocument: "1400000921",
  },
  /**
   * The credit note's FI side: a negative posting (BSEG posting key 15) that
   * reduces what the customer owes. It is left open rather than cleared, so
   * the statement shows a credit the customer can still set against a future
   * invoice — which is how a G2 usually sits until the next clearing run.
   */
  {
    documentNumber: "0090002250",
    documentType: "G2",
    postingDate: shiftDays(SEED_TODAY, -20),
    dueDate: shiftDays(SEED_TODAY, -20),
    amount: -14325.2,
    openAmount: -14325.2,
    currency: "INR",
    status: "Open",
  },
];

/** Which KUNNR each open item belongs to (BSID is keyed by customer). */
export const SEED_OPEN_ITEM_OWNER: Record<string, string> = {
  "0090002211": "0010001001",
  "0090002190": "0010001001",
  "0090002140": "0010001001",
  "0090002250": "0010001001",
  "0090002205": "0010001002",
};

export { shiftDays };
