"use client";

import type { AgingBucketKey, AgingSummary } from "@cc/domain";
import type { AgingBucketRow } from "@cc/service-reporting";
import { AmountAging, DocumentNumber, Money, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { useState } from "react";

/**
 * AR summary drill-down (docs/05 §7.10: "`AmountAging` buckets + drill-down
 * table per bucket → invoice links").
 *
 * `AmountAging` already renders the bar and takes an `onSelectBucket`; this
 * component only decides which bucket's rows to show under it. The bucketing
 * itself happened in `buildAging` in `@cc/domain` — the same function the
 * statement and the invoice list use, so the report cannot put a document in
 * a different bucket than the invoice screen does (ADR-018).
 *
 * Selection is local state rather than URL state, unlike the period chips:
 * a bucket is a momentary "what's in there?", not a view somebody forwards.
 */

export interface ArBucketDrilldownProps {
  aging: AgingSummary;
  documents: Record<AgingBucketKey, AgingBucketRow[]>;
}

export function ArBucketDrilldown({ aging, documents }: ArBucketDrilldownProps) {
  const [selected, setSelected] = useState<AgingBucketKey | null>(null);
  const bucket = selected ? aging.buckets.find((entry) => entry.key === selected) : undefined;
  const rows = selected ? documents[selected] : [];

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <AmountAging
          aging={aging}
          onSelectBucket={(key) => {
            setSelected((current) => (current === key ? null : key));
          }}
        />
        <p className="mt-3 text-[11.5px] text-text-dim">
          Select a bucket to list the documents in it. Amounts are what remains open on each
          document, not what it was billed for.
        </p>
      </section>

      {bucket ? (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-bold text-text">{bucket.label}</h2>
              <p className="text-[11.5px] text-text-dim">
                {rows.length} document{rows.length === 1 ? "" : "s"} ·{" "}
                <Money value={bucket.amount} className="text-[11.5px]" /> open
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
              }}
              className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-mid hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Close
            </button>
          </header>

          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-text-dim">
              Nothing outstanding in this bucket.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <caption className="sr-only">Open documents in {bucket.label}</caption>
                <thead>
                  <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                    <th scope="col" className="px-4 py-2 font-bold">
                      Document
                    </th>
                    <th scope="col" className="px-4 py-2 font-bold">
                      Posted
                    </th>
                    <th scope="col" className="px-4 py-2 font-bold">
                      Due
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">
                      Overdue
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">
                      Open amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.documentNumber} className="border-t border-border">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">
                        {row.isInvoice ? (
                          <Link
                            href={`/invoices/${row.documentNumber}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            <DocumentNumber value={row.documentNumber} />
                          </Link>
                        ) : (
                          <DocumentNumber value={row.documentNumber} />
                        )}
                        <span className="ml-2 text-[11px] text-text-dim">{row.documentType}</span>
                      </th>
                      <td className="px-4 py-2.5 tabular-nums text-text-mid">
                        {formatDisplayDate(row.postingDate)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-text-mid">
                        {formatDisplayDate(row.dueDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.daysOverdue > 0 ? (
                          <span className="text-danger">{row.daysOverdue} days</span>
                        ) : (
                          <span className="text-text-dim">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={row.openAmount} className="font-semibold" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
