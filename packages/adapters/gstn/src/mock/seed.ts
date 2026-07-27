import type { GstnTaxpayer } from "../contract";

/**
 * Seeded GSTN registry for the mock driver.
 *
 * Every entry is a structurally valid GSTIN (correct check digit), because
 * the portal's own validator runs first and a fixture that fails it would
 * never reach the driver. The set deliberately covers the unhappy paths the
 * wizard has to render: a cancelled registration, a suspended one, and a
 * well-formed number that simply isn't registered.
 */

type SeedTaxpayer = Omit<GstnTaxpayer, "checkedAt">;

export const GSTN_SEED: Readonly<Record<string, SeedTaxpayer>> = {
  "27AAPFU0939F1ZV": {
    gstin: "27AAPFU0939F1ZV",
    legalName: "Vertex Polymers Private Limited",
    tradeName: "Vertex Polymers",
    stateCode: "27",
    status: "Active",
    constitution: "Private Limited Company",
    registrationType: "01",
    registeredOn: "2018-07-01",
    principalPlaceOfBusiness: "Plot 14, MIDC Industrial Area, Pune, Maharashtra, 411018",
  },
  "29AAGCB7383J1Z4": {
    gstin: "29AAGCB7383J1Z4",
    legalName: "Bluepeak Components Private Limited",
    tradeName: "Bluepeak",
    stateCode: "29",
    status: "Active",
    constitution: "Private Limited Company",
    registrationType: "01",
    registeredOn: "2020-02-14",
    principalPlaceOfBusiness: "42 Peenya Industrial Area, Bengaluru, Karnataka, 560058",
  },
  "24AAACC1206D1ZM": {
    gstin: "24AAACC1206D1ZM",
    legalName: "Coastal Chemicals Limited",
    stateCode: "24",
    status: "Cancelled",
    constitution: "Public Limited Company",
    registrationType: "01",
    registeredOn: "2017-07-01",
  },
  "07AABCG1234M1ZQ": {
    gstin: "07AABCG1234M1ZQ",
    legalName: "Ganges Traders LLP",
    stateCode: "07",
    status: "Suspended",
    constitution: "Limited Liability Partnership",
    registrationType: "02",
    registeredOn: "2019-11-05",
  },
};

/**
 * Well-formed but deliberately unregistered — the fixture for the
 * "GSTIN not found" state. Kept here so tests and demo scripts reference
 * one constant instead of each inventing a number that might later be
 * seeded by accident.
 */
export const GSTN_UNREGISTERED_SPECIMEN = "33AAECS5678K1ZW";

/** PAN's 4th character encodes the holder's constitution. */
const CONSTITUTION_BY_PAN_TYPE: Readonly<Record<string, string>> = {
  C: "Private Limited Company",
  P: "Proprietorship",
  F: "Partnership Firm",
  H: "Hindu Undivided Family",
  A: "Association of Persons",
  T: "Trust",
  B: "Body of Individuals",
  L: "Local Authority",
  J: "Artificial Juridical Person",
  G: "Government",
};

export function constitutionForPan(pan: string): string {
  return CONSTITUTION_BY_PAN_TYPE[pan[3] ?? ""] ?? "Private Limited Company";
}
