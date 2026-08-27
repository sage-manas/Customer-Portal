import { LOCALE } from "@cc/config/constants";

/**
 * "Synced 5m ago" strings for SapSyncIndicator (docs/05 §6.1). Uses
 * Intl.RelativeTimeFormat so the en-IN locale (and future locales) get
 * correct phrasing rather than a hand-rolled English template.
 */
const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "narrow" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 1000],
  ["minute", 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
];

export function relativeTime(value: string | Date, now: Date = new Date()): string {
  const then = value instanceof Date ? value : new Date(value);
  const deltaMs = then.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);

  let unit: Intl.RelativeTimeFormatUnit = "second";
  let size = 1000;
  for (const [candidateUnit, candidateSize] of UNITS) {
    if (absMs >= candidateSize) {
      unit = candidateUnit;
      size = candidateSize;
    }
  }

  return formatter.format(Math.round(deltaMs / size), unit);
}

/** `02-Jun-25` display format (docs/05 §11). ISO stays in APIs. */
export function formatDisplayDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  })
    .format(date)
    .replace(/ /g, "-");
}
