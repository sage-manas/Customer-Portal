import { LOCALE, CURRENCY_SYMBOL } from "@cc/config/constants";

import { cn } from "../lib/cn";

export interface MoneyProps {
  /** Amount in the currency's major unit (rupees, not paise). */
  value: number;
  className?: string;
  /** Debit/credit sign coloring for ledger contexts (docs/05 §3.2). */
  tone?: "neutral" | "debit" | "credit";
  showSymbol?: boolean;
}

const TONE_CLASS: Record<NonNullable<MoneyProps["tone"]>, string> = {
  neutral: "text-text",
  debit: "text-danger",
  credit: "text-success",
};

/**
 * Formats INR with lakh/crore grouping (en-IN), always mono, right-aligned
 * by convention in tables (apply text-right on the containing cell).
 */
export function Money({ value, className, tone = "neutral", showSymbol = true }: MoneyProps) {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return (
    <span className={cn("font-mono text-[12.5px] tabular-nums", TONE_CLASS[tone], className)}>
      {showSymbol ? `${CURRENCY_SYMBOL} ` : ""}
      {formatted}
    </span>
  );
}
