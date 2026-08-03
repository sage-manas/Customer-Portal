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
  RebateAgreement,
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

/**
 * A year of closed trading history for 0010001001 — Module 10's reason for
 * existing. Doc 05 §7.10 asks for a twelve-month bar chart, a top-products
 * ranking and an AOV trend, and the orders above span sixty days: every one
 * of those charts would be one bar and a straight line in a fresh demo,
 * which is exactly the shape that hides a bug in the bucketing.
 *
 * They are all `Closed` deliberately. The dashboard's open-order KPI, the
 * credit exposure and the orders list's default view are all computed from
 * this array, and a year of history that quietly trebled every one of them
 * would be a seed change masquerading as a reporting change.
 *
 * The material mix is uneven on purpose: MAT-10001 dominates by value,
 * MAT-20002 by quantity, and two materials appear once each. A "top
 * products" chart ranked correctly and one ranked by row count look
 * identical against a flat mix.
 */
const HISTORIC_ORDERS: OrderStatusView[] = [
  {
    vbeln: "0000004601",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -330),
    customerPoRef: "PO-SH-8102",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 636562.5,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 15,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 636562.5,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004602",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -298),
    customerPoRef: "PO-SH-8149",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 271400,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-20002",
        description: "Seamless Steel Pipe 4in Sch40",
        quantity: 250,
        uom: "M",
        netPrice: 1085.6,
        netValue: 271400,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004603",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -265),
    customerPoRef: "PO-SH-8203",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 449142.5,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 9,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 381937.5,
        plant: "1000",
      },
      {
        lineNo: 20,
        material: "MAT-30001",
        description: "Nitrile Gasket Set 150mm",
        quantity: 82,
        uom: "SET",
        netPrice: 818.8,
        netValue: 67141.6,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004604",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -231),
    customerPoRef: "PO-SH-8266",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 174640,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-50001",
        description: "Pressure Gauge 0-16 bar",
        quantity: 80,
        uom: "EA",
        netPrice: 2183,
        netValue: 174640,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004605",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -196),
    customerPoRef: "PO-SH-8321",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 848750,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 20,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 848750,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004606",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -164),
    customerPoRef: "PO-SH-8390",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 217120,
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
      },
    ],
  },
  {
    vbeln: "0000004607",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -128),
    customerPoRef: "PO-SH-8452",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 594125,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 14,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 594125,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004608",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -96),
    customerPoRef: "PO-SH-8517",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 103068,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-30001",
        description: "Nitrile Gasket Set 150mm",
        quantity: 126,
        uom: "SET",
        netPrice: 818.8,
        netValue: 103168.8,
        plant: "1000",
      },
    ],
  },
  {
    // A cancelled order (ADR-017 leaves every item rejected). It is seeded so
    // the charts have something to *exclude*: `isReportableOrder` drops it,
    // and without one here a bug that counted cancellations would be
    // invisible in every demo and every E2E run.
    vbeln: "0000004609",
    kunnr: "0010001001",
    createdOn: shiftDays(SEED_TODAY, -150),
    customerPoRef: "PO-SH-8377",
    orderStatus: "Rejected",
    creditStatus: "Confirmed",
    netValue: 1500000,
    currency: "INR",
    rejectionReason: "Cancelled at customer request",
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        description: "Hydraulic Pump HP-200",
        quantity: 35,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 1485312.5,
        plant: "1000",
      },
    ],
  },
  {
    vbeln: "0000004650",
    kunnr: "0010001002",
    createdOn: shiftDays(SEED_TODAY, -210),
    customerPoRef: "PO-NR-4402",
    orderStatus: "Closed",
    creditStatus: "Confirmed",
    netValue: 482000,
    currency: "INR",
    lines: [
      {
        lineNo: 10,
        material: "MAT-50001",
        description: "Pressure Gauge 0-16 bar",
        quantity: 221,
        uom: "EA",
        netPrice: 2183,
        netValue: 482443,
        plant: "1000",
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
  ...HISTORIC_ORDERS,
];

/**
 * LIKP/LIPS, linked to the seeded sales orders above. Between them the three
 * rows cover every state the delivery screens have to render: one signed for
 * (POD already posted), one in transit (the POD happy path), and one still in
 * the warehouse, which is the case where the portal must *not* offer a
 * Confirm Receipt button.
 */
/**
 * Shipments for the closed orders above, for the same reason they exist:
 * docs/03 Module 10 wants an on-time-delivery percentage, and three seeded
 * deliveries — all of them shipped on their planned date — make that KPI
 * read 100% forever, which is indistinguishable from a rate that is never
 * computed at all.
 *
 * So two of these went out late (0080001760 by six days, 0080001812 by two)
 * and one has no planned goods issue at all. The last is the interesting
 * one: `onTimeDelivery` reports it as `unmeasured` rather than scoring it,
 * because a delivery with no WADAT to judge against would otherwise let a
 * tenant's OTD rise by not planning.
 */
const HISTORIC_DELIVERIES: Delivery[] = [
  {
    vbeln: "0080001702",
    salesOrder: "0000004601",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -323),
    actualGoodsIssue: shiftDays(SEED_TODAY, -323),
    carrier: "BLUEDART",
    trackingNumber: "BD41120988IN",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -321),
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        quantity: 15,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 636562.5,
      },
    ],
  },
  {
    vbeln: "0080001744",
    salesOrder: "0000004602",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -291),
    actualGoodsIssue: shiftDays(SEED_TODAY, -292),
    carrier: "VRL",
    trackingNumber: "VRL7612044",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -289),
    lines: [
      {
        lineNo: 10,
        material: "MAT-20002",
        quantity: 250,
        uom: "M",
        netPrice: 1085.6,
        netValue: 271400,
      },
    ],
  },
  {
    vbeln: "0080001760",
    salesOrder: "0000004603",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -258),
    actualGoodsIssue: shiftDays(SEED_TODAY, -252),
    carrier: "GATI",
    trackingNumber: "GT88120441",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -250),
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        quantity: 9,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 381937.5,
      },
      {
        lineNo: 20,
        material: "MAT-30001",
        quantity: 82,
        uom: "SET",
        netPrice: 818.8,
        netValue: 67141.6,
      },
    ],
  },
  {
    vbeln: "0080001790",
    salesOrder: "0000004604",
    kunnr: "0010001001",
    status: "Delivered",
    // No WADAT — a rush order despatched without a planned date.
    actualGoodsIssue: shiftDays(SEED_TODAY, -226),
    carrier: "BLUEDART",
    trackingNumber: "BD44902117IN",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -224),
    lines: [
      {
        lineNo: 10,
        material: "MAT-50001",
        quantity: 80,
        uom: "EA",
        netPrice: 2183,
        netValue: 174640,
      },
    ],
  },
  {
    vbeln: "0080001812",
    salesOrder: "0000004605",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -189),
    actualGoodsIssue: shiftDays(SEED_TODAY, -187),
    carrier: "VRL",
    trackingNumber: "VRL7690155",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -185),
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        quantity: 20,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 848750,
      },
    ],
  },
  {
    vbeln: "0080001855",
    salesOrder: "0000004607",
    kunnr: "0010001001",
    status: "Delivered",
    plannedGoodsIssue: shiftDays(SEED_TODAY, -121),
    actualGoodsIssue: shiftDays(SEED_TODAY, -121),
    carrier: "GATI",
    trackingNumber: "GT88451209",
    podConfirmed: true,
    podReceiptDate: shiftDays(SEED_TODAY, -119),
    lines: [
      {
        lineNo: 10,
        material: "MAT-10001",
        quantity: 14,
        uom: "EA",
        netPrice: 42437.5,
        netValue: 594125,
      },
    ],
  },
];

export const SEED_DELIVERIES: Delivery[] = [
  ...HISTORIC_DELIVERIES,
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
   * Three settled invoices earlier in the same fiscal year (FY 2026-27 starts
   * 1 April). They exist for Module 9: a loyalty tier is computed from VBRK
   * over the fiscal year, and an account whose whole seeded history is the
   * last two months sits at the entry tier forever, which makes the tier card
   * and its progress bar untestable in a fresh demo. They are all cleared, so
   * nothing about aging, the open-item list or the payable set changes.
   */
  {
    vbeln: "0090002085",
    billingDate: shiftDays(SEED_TODAY, -106),
    reference: "0080001702",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 2480000,
    cgst: 223200,
    sgst: 223200,
    igst: 0,
    grossAmount: 2926400,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -76),
    status: "Paid",
    pdfUrl: "/mock/sap/billing/0090002085.pdf",
  },
  {
    vbeln: "0090002110",
    billingDate: shiftDays(SEED_TODAY, -81),
    reference: "0080001744",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 1860000,
    cgst: 167400,
    sgst: 167400,
    igst: 0,
    grossAmount: 2194800,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -51),
    status: "Paid",
    pdfUrl: "/mock/sap/billing/0090002110.pdf",
  },
  {
    vbeln: "0090002165",
    billingDate: shiftDays(SEED_TODAY, -42),
    reference: "0080001821",
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 1795000,
    cgst: 161550,
    sgst: 161550,
    igst: 0,
    grossAmount: 2118100,
    currency: "INR",
    dueDate: shiftDays(SEED_TODAY, -12),
    status: "Paid",
    pdfUrl: "/mock/sap/billing/0090002165.pdf",
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
  /** The FI side of the three settled invoices above — cleared, nothing open. */
  {
    documentNumber: "0090002085",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -106),
    dueDate: shiftDays(SEED_TODAY, -76),
    amount: 2926400,
    openAmount: 0,
    currency: "INR",
    status: "Cleared",
    clearingDocument: "1400000904",
  },
  {
    documentNumber: "0090002110",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -81),
    dueDate: shiftDays(SEED_TODAY, -51),
    amount: 2194800,
    openAmount: 0,
    currency: "INR",
    status: "Cleared",
    clearingDocument: "1400000911",
  },
  {
    documentNumber: "0090002165",
    documentType: "RV",
    postingDate: shiftDays(SEED_TODAY, -42),
    dueDate: shiftDays(SEED_TODAY, -12),
    amount: 2118100,
    openAmount: 0,
    currency: "INR",
    status: "Cleared",
    clearingDocument: "1400000918",
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
  "0090002085": "0010001001",
  "0090002110": "0010001001",
  "0090002165": "0010001001",
  "0090002205": "0010001002",
};

/**
 * KONA rebate agreements (docs/03 Screen 9.2).
 *
 * One live agreement for the demo account, so the rebate card has something to
 * render, and one that lapsed at the end of the previous fiscal year — the
 * screen shows only the live ones, and an "expired" row nobody filtered would
 * otherwise be indistinguishable in a demo from a filter that doesn't work.
 * 0010001002 has none, which is the empty state.
 */
export const SEED_REBATES: RebateAgreement[] = [
  {
    agreementNumber: "0000801234",
    kunnr: "0010001001",
    agreementType: "0002",
    description: "Annual volume rebate — MRO consumables",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    // KAWRT: what SAP has accrued so far this year. Not derived from the
    // seeded invoices on purpose — the accrual is a settlement-run figure,
    // and a mock that recomputed it would teach the portal a habit it must
    // not have.
    accruedAmount: 138034,
    settlementStatus: "B",
    currency: "INR",
  },
  {
    agreementNumber: "0000800987",
    kunnr: "0010001001",
    agreementType: "0002",
    description: "Annual volume rebate — MRO consumables (FY 2025-26)",
    validFrom: "2025-04-01",
    validTo: "2026-03-31",
    accruedAmount: 96500,
    settlementStatus: "D",
    currency: "INR",
  },
  {
    agreementNumber: "0000801301",
    kunnr: "0010001003",
    agreementType: "0003",
    description: "Growth rebate — structural steel",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    accruedAmount: 0,
    settlementStatus: "B",
    currency: "INR",
  },
];

export { shiftDays };
