"use client";

import { Button, Input } from "@cc/ui";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * SAP-style material match-code search.
 *
 * Typing a character opens the hit list of every material whose MATNR or
 * MAKTX *starts with* what has been typed — the same prefix semantics as the
 * F4 help in the GUI — and picking a row opens that material's full view
 * rather than filtering the grid. Submitting without picking still falls
 * back to the URL-driven filter, so the search box keeps its old behaviour
 * for people who just want a narrowed catalogue.
 *
 * The hit list is a debounced server search (`POST
 * /api/catalogue/materials/search`), not a client-side filter over the whole
 * catalogue — that dump does not scale past a seeded demo (REMEDIATION-PLAN
 * §5). The matching rules themselves live in `searchMaterials` on the
 * service, so this component only renders what the server returns.
 */

export interface MaterialSuggestion {
  material: string;
  description: string;
  materialGroup: string;
  uom: string;
}

export function MaterialSearchBox({
  search,
  onSubmit,
}: {
  search?: string;
  onSubmit: (value: string | undefined) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(search ?? "");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [hits, setHits] = React.useState<MaterialSuggestion[]>([]);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => setDraft(search ?? ""), [search]);

  const query = draft.trim();

  React.useEffect(() => {
    if (!query) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    // 200ms is below the threshold where a hit list feels laggy, and high
    // enough that a typed word costs one request rather than one per
    // keystroke.
    const timer = setTimeout(() => {
      fetch("/api/catalogue/materials/search", {
        method: "POST",
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { materials: [] }))
        .then((data: { materials?: MaterialSuggestion[] }) => {
          setHits(data.materials ?? []);
          setActive(0);
        })
        // An aborted or failed lookup leaves the last hit list up rather than
        // flashing "no matches" at someone who is still typing.
        .catch(() => {});
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // A click anywhere else dismisses the hit list; the input keeps its text so
  // the buyer can go on to filter the grid with it.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (item: MaterialSuggestion) => {
    setOpen(false);
    router.push(`/catalogue/${encodeURIComponent(item.material)}`);
  };

  const showList = open && hits.length > 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      // Enter opens the highlighted row; the button beside the box is what
      // filters the grid by the typed text instead.
      event.preventDefault();
      choose(hits[active]);
    }
  };

  return (
    <div ref={boxRef} className="relative flex min-w-64 flex-1 items-end gap-2">
      <label className="block flex-1">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Search
        </span>
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Material code or description"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        />
      </label>

      <Button
        type="submit"
        variant="secondary"
        aria-label="Search catalogue"
        onClick={() => {
          setOpen(false);
          onSubmit(query || undefined);
        }}
      >
        <Search aria-hidden className="size-3.5" />
      </Button>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching materials"
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-sm border border-border bg-surface py-1 shadow-md"
        >
          {hits.map((item, index) => (
            <li key={item.material}>
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // pointerdown, not click: the input's blur would otherwise
                // close the list before the click ever lands.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left ${
                  index === active ? "bg-background" : ""
                }`}
              >
                <span className="w-24 shrink-0 font-mono text-[11px] tracking-tight text-text-dim">
                  {item.material}
                </span>
                <span className="flex-1 truncate text-[12.5px] text-text">{item.description}</span>
                <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-text-dim">
                  {item.materialGroup} · {item.uom}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
