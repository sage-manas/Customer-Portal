import { describe, expect, it } from "vitest";

import {
  GST_STATE_CODES,
  STATE_OPTIONS,
  gstinChecksumChar,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  isValidPhone,
  isValidPinCode,
  panFromGstin,
  stateCodeFromGstin,
  stateName,
} from "./india";

/** Real-format specimens: 27 = Maharashtra, 29 = Karnataka. */
const MAHARASHTRA_GSTIN = "27AAPFU0939F1ZV";
const KARNATAKA_GSTIN = "29AAGCB7383J1Z4";

describe("PAN", () => {
  it("accepts the AAAAA9999A form", () => {
    expect(isValidPan("AAPFU0939F")).toBe(true);
  });

  it.each(["AAPFU0939", "aapfu0939f1", "12345U0939F", "AAPFU093AF"])("rejects %s", (value) => {
    expect(isValidPan(value)).toBe(false);
  });

  it("is case-insensitive — the portal upper-cases before it stores", () => {
    expect(isValidPan("aapfu0939f")).toBe(true);
  });
});

describe("GSTIN", () => {
  it.each([MAHARASHTRA_GSTIN, KARNATAKA_GSTIN])("accepts %s", (gstin) => {
    expect(isValidGstin(gstin)).toBe(true);
  });

  it("rejects a wrong check digit — that is a typo, not an unregistered dealer", () => {
    const wrongCheckDigit = `${MAHARASHTRA_GSTIN.slice(0, 14)}A`;
    expect(wrongCheckDigit).not.toBe(MAHARASHTRA_GSTIN);
    expect(isValidGstin(wrongCheckDigit)).toBe(false);
  });

  it("rejects an unassigned state code even when the checksum is consistent", () => {
    const body = `99${MAHARASHTRA_GSTIN.slice(2, 14)}`;
    expect(isValidGstin(`${body}${gstinChecksumChar(body)}`)).toBe(false);
  });

  it.each(["27AAPFU0939F1Z", "27AAPFU0939F1AV", ""])("rejects malformed %s", (value) => {
    expect(isValidGstin(value)).toBe(false);
  });

  it("exposes the embedded PAN and state code", () => {
    expect(panFromGstin(MAHARASHTRA_GSTIN)).toBe("AAPFU0939F");
    expect(stateCodeFromGstin(MAHARASHTRA_GSTIN)).toBe("27");
  });

  it("returns null for a body it cannot score", () => {
    expect(gstinChecksumChar("short")).toBeNull();
    expect(gstinChecksumChar("27AAPFU0939F1-")).toBeNull();
  });
});

describe("IFSC / PIN / phone", () => {
  it("accepts a well-formed IFSC (5th char is always 0)", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("HDFC1001234")).toBe(false);
  });

  it("requires a 6-digit PIN that does not start with 0", () => {
    expect(isValidPinCode("400001")).toBe(true);
    expect(isValidPinCode("040001")).toBe(false);
    expect(isValidPinCode("40001")).toBe(false);
  });

  it("accepts 10-15 digit phone numbers, ignoring spaces and dashes", () => {
    expect(isValidPhone("9820098200")).toBe(true);
    expect(isValidPhone("98200-98200")).toBe(true);
    expect(isValidPhone("98200")).toBe(false);
  });
});

describe("state registry", () => {
  it("maps a code to its name", () => {
    expect(stateName("27")).toBe("Maharashtra");
    expect(stateName(undefined)).toBeUndefined();
  });

  it("offers every code as a sorted select option", () => {
    expect(STATE_OPTIONS).toHaveLength(Object.keys(GST_STATE_CODES).length);
    const names = STATE_OPTIONS.map((option) => option.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
