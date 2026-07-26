"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Skeleton } from "../primitives/skeleton";

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Server-pagination row count is unknown from `data.length` alone. */
  pageCount?: number;
  pageIndex?: number;
  pageSize?: number;
  onPageChange?: (pageIndex: number) => void;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

/**
 * TanStack Table wrapper per docs/05 §3.2: server pagination, column sort,
 * sticky header, zebra rows, and built-in loading/empty/error states.
 * Sorting/pagination are controlled from outside when `manual` (server
 * data) is in play — pass `sorting`/`onSortingChange` and
 * `pageIndex`/`onPageChange`.
 */
export function DataTable<TData>({
  columns,
  data,
  pageCount,
  pageIndex = 0,
  pageSize = 25,
  onPageChange,
  sorting,
  onSortingChange,
  loading = false,
  error,
  onRetry,
  emptyMessage = "No records found",
  emptyAction,
  className,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: pageCount !== undefined,
    manualSorting: Boolean(onSortingChange),
    pageCount: pageCount ?? -1,
    state: { sorting, pagination: { pageIndex, pageSize } },
    onSortingChange,
  });

  return (
    <div className={cn("overflow-x-auto rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 bg-background">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-mid"
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDir === "asc" && <ArrowUp size={12} />}
                        {sortDir === "desc" && <ArrowDown size={12} />}
                        {!sortDir && <ArrowUpDown size={12} className="opacity-40" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((_col, colIdx) => (
                  <td key={colIdx} className="px-3 py-2.5">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : error ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center">
                <p className="mb-3 text-text-mid">{error}</p>
                {onRetry && (
                  <Button variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center">
                <p className="mb-3 text-text-dim">{emptyMessage}</p>
                {emptyAction}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row, idx) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border last:border-0",
                  idx % 2 === 1 && "bg-background/50",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2.5 text-text">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {pageCount !== undefined && pageCount > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-text-dim">
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pageIndex === 0}
              onClick={() => onPageChange(pageIndex - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => onPageChange(pageIndex + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
