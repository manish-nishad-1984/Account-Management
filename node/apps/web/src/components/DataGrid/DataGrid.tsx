import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import clsx from "clsx";
import type { SortDirection } from "@accountmanagement/contracts";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import { Button, EmptyState } from "../ui";

export interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  rows: T[];
  total: number | null;
  isLoading: boolean;
  error?: string | null;

  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  sortBy: string | undefined;
  sortDir: SortDirection;
  onSortChange: (field: string, direction: SortDirection) => void;
  sortableFields: readonly string[];

  canGoBack: boolean;
  canGoForward: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageIndex: number;
  emptyMessage?: string;
}

/**
 * Server-paged table.
 *
 * No client-side sort, filter or page model: each is a request. The existing app
 * renders every row of every grid server-side and ships the lot to the browser —
 * 16 of 19 grids do this, and the three using DataTables set `serverSide: true`
 * AND `paging: false`, defeating the plumbing they already had.
 */
export function DataGrid<T>({
  columns,
  rows,
  total,
  isLoading,
  error,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  sortBy,
  sortDir,
  onSortChange,
  sortableFields,
  canGoBack,
  canGoForward,
  onPrevious,
  onNext,
  pageIndex,
  emptyMessage = "Nothing to show",
}: DataGridProps<T>) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
        <div className="relative">
          <input
            aria-label="Search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            className="w-72 rounded-lg border-0 py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 transition-shadow placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
          />
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        </div>
        {total !== null && (
          <span data-testid="record-count" className="text-sm text-slate-500">
            <span className="tabular font-medium text-slate-700">{total}</span>{" "}
            {total === 1 ? "record" : "records"}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200/80 text-sm">
          <thead className="bg-slate-50/80">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const field = header.column.id;
                  const sortable = sortableFields.includes(field);
                  const active = sortBy === field;
                  const label = flexRender(header.column.columnDef.header, header.getContext());

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          aria-label={`Sort by ${field}`}
                          onClick={() =>
                            onSortChange(field, active && sortDir === "asc" ? "desc" : "asc")
                          }
                          className={clsx(
                            "inline-flex items-center gap-1 hover:text-slate-800",
                            active && "text-brand-700",
                          )}
                        >
                          {label}
                          <span aria-hidden className={clsx(!active && "text-slate-300")}>
                            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {isLoading ? (
              Array.from({ length: 6 }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((_, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3">
                      <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState icon={Inbox} title={emptyMessage} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200/80 bg-slate-50/40 px-4 py-3">
        <span className="text-sm text-slate-500">Page <span className="tabular font-medium text-slate-700">{pageIndex + 1}</span></span>
        <div className="flex gap-2">
          <Button variant="secondary" icon={ChevronLeft} disabled={!canGoBack} onClick={onPrevious}>
            Previous
          </Button>
          <Button variant="secondary" disabled={!canGoForward} onClick={onNext}>
            Next
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
