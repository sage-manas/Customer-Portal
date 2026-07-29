"use client";

import type { SalesDocLine } from "@cc/domain";
import { Button, Input, Money } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Issue a quotation against one inquiry (VA21) — the minimal workbench
 * docs/07 A4 asks for: the lines the customer asked about, a price per line,
 * and a validity date.
 *
 * A blank price is not zero: an omitted line is priced by SAP from the
 * customer's own condition records, which is what VA21 does when nobody
 * intervenes. A workbench that forced a number on every line would make the
 * tenant's pricing procedure decorative.
 */

interface ApiIssue {
  field: string;
  message: string;
}

export function IssueQuotationPanel({
  inquiryVbeln,
  lines,
  defaultValidUntil,
}: {
  inquiryVbeln: string;
  lines: SalesDocLine[];
  defaultValidUntil: string;
}) {
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [validUntil, setValidUntil] = React.useState(defaultValidUntil);
  const [prices, setPrices] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [issues, setIssues] = React.useState<ApiIssue[]>([]);

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  async function issue() {
    setBusy(true);
    setError(undefined);
    setIssues([]);
    try {
      const response = await fetch("/api/admin/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inquiryVbeln,
          validUntil,
          lines: Object.entries(prices)
            .filter(([, value]) => value.trim() !== "")
            .map(([lineNo, value]) => ({ lineNo: Number(lineNo), netPrice: Number(value) })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          issues?: ApiIssue[];
        };
        setError(body.error ?? "That didn't work. Try again in a moment.");
        setIssues(body.issues ?? []);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Quote
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-background p-3">
      {error ? (
        <p role="alert" className="mb-2 text-[11.5px] text-danger">
          {error}
        </p>
      ) : null}

      <ul className="mb-3 flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.lineNo} className="flex items-center gap-3">
            <span className="min-w-40 flex-1 text-[12px] text-text-mid">
              <span className="font-mono text-[10.5px] text-text-dim">{line.material}</span>{" "}
              {line.quantity} {line.uom}
            </span>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-text-dim">Unit price</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="w-32"
                placeholder="From conditions"
                value={prices[line.lineNo] ?? ""}
                onChange={(event) =>
                  setPrices((current) => ({ ...current, [line.lineNo]: event.target.value }))
                }
              />
            </label>
            {prices[line.lineNo] ? (
              <Money
                value={Number(prices[line.lineNo]) * line.quantity}
                className="w-28 text-right text-[12px] font-semibold"
              />
            ) : (
              <span className="w-28 text-right text-[11px] text-text-dim">SAP prices it</span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
            Valid until
          </span>
          <Input
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          {issueFor("validUntil") ? (
            <span className="mt-1 block text-[11px] text-danger">{issueFor("validUntil")}</span>
          ) : null}
        </label>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void issue()} loading={busy} disabled={!validUntil}>
            Issue quotation
          </Button>
        </div>
      </div>
    </div>
  );
}
