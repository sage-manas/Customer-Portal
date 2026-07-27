"use client";

import { Button, Input, Select } from "@cc/ui";
import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Catalogue filter rail (docs/05 §7.2: search MATNR/MAKTX, category MATKL,
 * plant WERKS).
 *
 * Filters live in the URL, not in component state: a filtered catalogue is
 * something buyers share with colleagues and bookmark, and doc 05 §6.3
 * treats a filtered list as a first-class view.
 */

// MARC-WERKS values the mock landscape ships. This becomes a tenant-configured
// plant list when tenant settings arrive (Phase 7).
const PLANTS = ["1000", "2000"];

export function CatalogueFilters({
  groups,
  search,
  group,
  plant,
  total,
}: {
  groups: string[];
  search?: string;
  group?: string;
  plant?: string;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = React.useState(search ?? "");

  React.useEffect(() => setDraft(search ?? ""), [search]);

  const apply = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/catalogue?${next.toString()}`);
  };

  const active = Boolean(search || group || plant);

  return (
    <section className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3.5 shadow-sm">
      <form
        className="flex min-w-64 flex-1 items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply("q", draft.trim() || undefined);
        }}
      >
        <label className="flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
            Search
          </span>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Material code or description"
          />
        </label>
        <Button type="submit" variant="secondary" aria-label="Search catalogue">
          <Search aria-hidden className="size-3.5" />
        </Button>
      </form>

      <label className="w-44">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Material group
        </span>
        <Select
          value={group ?? ""}
          onChange={(event) => apply("group", event.target.value || undefined)}
          options={[
            { value: "", label: "All groups" },
            ...groups.map((value) => ({ value, label: value })),
          ]}
        />
      </label>

      <label className="w-36">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Plant
        </span>
        <Select
          value={plant ?? ""}
          onChange={(event) => apply("plant", event.target.value || undefined)}
          options={[
            { value: "", label: "All plants" },
            ...PLANTS.map((value) => ({ value, label: value })),
          ]}
        />
      </label>

      <div className="ml-auto flex items-center gap-3 pb-1.5">
        <span className="text-[11.5px] text-text-dim">
          {total} {total === 1 ? "item" : "items"}
        </span>
        {active ? (
          <Button variant="ghost" size="sm" onClick={() => router.push("/catalogue")}>
            <X aria-hidden className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
    </section>
  );
}
