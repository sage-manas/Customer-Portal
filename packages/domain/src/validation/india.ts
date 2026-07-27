/**
 * Indian statutory identifier validation (docs/05-UI-UX-DESIGN.md §6.2:
 * "domain validators (GSTIN regex + checksum, PAN `AAAAA9999A`, IFSC
 * 11-char, PIN 6-digit)").
 *
 * These live in `domain` because they are business rules, not screen
 * rules: the wizard, the API and the back-office approval screen all reach
 * the same verdict from the same code. Format/length that *SAP* imposes
 * still comes from the sap-mapping registry — this file only adds the
 * checks the SAP dictionary type cannot express.
 */

/** T005S region codes for India == GST state codes (2-digit numeric). */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export interface StateOption {
  /** KNA1-REGIO / T005S code. */
  code: string;
  name: string;
}

/** Select options for the State field (KNA1-REGIO), sorted by name. */
export const STATE_OPTIONS: readonly StateOption[] = Object.entries(GST_STATE_CODES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function stateName(code: string | undefined): string | undefined {
  return code ? GST_STATE_CODES[code] : undefined;
}

/** GST registration types — J_1IMOCUST-J_1IGSTIN_REGTP (docs/03 Screen 1.2). */
export const GST_REGISTRATION_TYPES: readonly StateOption[] = [
  { code: "01", name: "Regular" },
  { code: "02", name: "Composition" },
  { code: "03", name: "Unregistered" },
  { code: "04", name: "SEZ" },
];

/** KNA1-KTOKD account groups offered on the wizard (docs/03 Screen 1.1). */
export const CUSTOMER_TYPES: readonly StateOption[] = [
  { code: "Z001", name: "Retailer" },
  { code: "Z002", name: "Distributor" },
  { code: "Z003", name: "Direct" },
  { code: "Z004", name: "Export" },
];

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PIN_PATTERN = /^[1-9][0-9]{5}$/;
export const PHONE_PATTERN = /^[0-9]{10,15}$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

const CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * GSTIN check digit (15th character): positions 1..14 are weighted 1,2
 * alternately in base-36, each product's quotient and remainder summed,
 * and the total's complement to the next multiple of 36 is the check digit.
 * This is the published GSTN algorithm — a GSTIN that fails it is a typo,
 * not an unregistered dealer, so we can say so before calling the API.
 */
export function gstinChecksumChar(first14: string): string | null {
  if (first14.length !== 14) return null;

  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const value = CHECKSUM_ALPHABET.indexOf(first14[index]!);
    if (value < 0) return null;
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }

  return CHECKSUM_ALPHABET[(36 - (sum % 36)) % 36]!;
}

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(value.toUpperCase());
}

export function isValidIfsc(value: string): boolean {
  return IFSC_PATTERN.test(value.toUpperCase());
}

export function isValidPinCode(value: string): boolean {
  return PIN_PATTERN.test(value);
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.replace(/[\s-]/g, ""));
}

export function isValidGstin(value: string): boolean {
  const gstin = value.toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return false;
  if (!(gstin.slice(0, 2) in GST_STATE_CODES)) return false;
  return gstinChecksumChar(gstin.slice(0, 14)) === gstin[14];
}

/** Characters 3-12 of a GSTIN are the holder's PAN (docs/03 Screen 1.2). */
export function panFromGstin(gstin: string): string {
  return gstin.toUpperCase().slice(2, 12);
}

/** Characters 1-2 of a GSTIN are the registration's state code. */
export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}
