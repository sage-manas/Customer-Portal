/**
 * Cross-cutting, non-domain constants (localization/runtime).
 * Business entities, status codes and SAP field mappings live in
 * packages/domain instead — this file stays deliberately small.
 */

export const LOCALE = "en-IN";
export const CURRENCY = "INR";
export const CURRENCY_SYMBOL = "₹";
export const TIMEZONE = "Asia/Kolkata";
export const DEFAULT_COUNTRY = "IN";

/** Indian fiscal year runs April (4) to March (3 of next year). */
export const FISCAL_YEAR_START_MONTH = 4;

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const MAX_UPLOAD_SIZE_MB = 5;
export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
