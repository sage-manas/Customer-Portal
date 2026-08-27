"use client";

import { STATEMENT_DOC_TYPES } from "@cc/domain";
import { Button, Input, Select } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Statement filters (docs/03 Screen 7.1: date range on BKPF-BUDAT, doc type
 * on BKPF-BLART).
 *
 * URL state, like every other filter in the portal — a statement for a given
 * quarter is something a customer's accounts team links to and re-opens.
 *
 * The doc-type options come from the `STATEMENT_DOC_TYPES` registry in
 * @cc/domain rather than being typed here, so the labels the statement table
 * renders and the ones this dropdown offers can't drift apart.
 */

export function StatementFilters({
  from,
  to,
  docType,
}: {
  from?: string;
  to?: string;
  docType?: string;
}) {
  const router = useRouter();
  const [range, setRange] = React.useState({ from: from ?? "", to: to ?? "" });
  const [type, setType] = React.useState(docType ?? "");

  function apply(next: { from: string; to: string; type: string }) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.type) params.set("docType", next.type);

    const query = params.toString();
    router.push(query ? `/payments?${query}` : "/payments");
  }

  const isFiltered = Boolean(from ?? to ?? docType);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ ...range, type });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          From
        </span>
        <Input
          type="date"
          value={range.from}
          onChange={(event) => setRange((r) => ({ ...r, from: event.target.value }))}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">To</span>
        <Input
          type="date"
          value={range.to}
          onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Document type
        </span>
        <Select
          value={type}
          onChange={(event) => setType(event.target.value)}
          options={[
            { value: "", label: "All" },
            ...STATEMENT_DOC_TYPES.map((option) => ({
              value: option.code,
              label: option.label,
            })),
          ]}
        />
      </label>

      <Button type="submit" variant="secondary">
        Apply
      </Button>

      {isFiltered ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setRange({ from: "", to: "" });
            setType("");
            apply({ from: "", to: "", type: "" });
          }}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
