import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import clsx from "clsx";
import type { MouseEvent, ReactNode } from "react";
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

  /**
   * A footer row of aggregates, keyed by column id.
   *
   * Only the inward-challan grid has one — the legacy screen totals its Quantity
   * column in a purple footer row, and it is the only grid in the system that
   * does. Rendered as a real `<tfoot>` so a screen reader announces it as part of
   * the table rather than as loose text underneath.
   *
   * The values must be totals over the whole FILTERED SET, not the page: a
   * footer that silently means "this page only" is worse than none. The server
   * computes them; this only draws them.
   */
  footer?: Record<string, ReactNode>;

  /**
   * Open the record by clicking anywhere in its row.
   *
   * Supplied only in the SPLIT layout, by `useMasterScreen` — the legacy screens
   * work this way and a docked pane is useless without it. In the modal layout
   * it is undefined and a row is inert, because a stray click that throws a
   * blocking dialog over the list is not a feature.
   */
  onRowClick?: (row: T) => void;

  /** The row currently open beside the list, so it can be marked as such. */
  selectedRowId?: string | number | null;
}

/**
 * Server-paged table.
 *
 * No client-side sort, filter or page model: each is a request. The existing app
 * renders every row of every grid server-side and ships the lot to the browser —
 * 16 of 19 grids do this, and the three using DataTables set `serverSide: true`
 * AND `paging: false`, defeating the plumbing they already had.
 */
/**
 * A click on a CONTROL inside the row belongs to that control, not to the row.
 *
 * Rows carry Edit, Delete and Approve buttons. Without this, clicking Delete
 * would also open the record beside the list, and the confirmation would appear
 * over a pane that had just filled with the same record — which reads as the app
 * doing two things at once because it is.
 */
function handleRowActivate<T>(
  event: MouseEvent<HTMLTableRowElement>,
  row: T,
  onRowClick: (row: T) => void,
): void {
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input, select, textarea, label, [role=\"menu\"]")) {
    return;
  }
  // A drag to select text in a cell is reading, not clicking.
  if ((window.getSelection()?.toString() ?? "") !== "") {
    return;
  }
  onRowClick(row);
}

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
  footer,
  onRowClick,
  selectedRowId = null,
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
                          /*
                            `-my-3 py-3` makes the button fill the header cell's
                            own vertical padding, so the whole cell sorts instead
                            of a 16px strip of text inside it. Nothing moves: the
                            negative margin returns exactly what the padding adds.
                          */
                          className={clsx(
                            "-my-3 inline-flex items-center gap-1 py-3 hover:text-slate-800",
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
              table.getRowModel().rows.map((row) => {
                const id = (row.original as { id?: string | number }).id;
                const selected =
                  selectedRowId !== null && selectedRowId !== undefined && id === selectedRowId;

                return (
                  <tr
                    key={row.id}
                    /**
                     * `aria-current`, not `aria-selected`: a plain table row is
                     * not in a selection widget, and `aria-selected` on one is
                     * ignored or reported oddly depending on the reader.
                     */
                    aria-current={selected ? true : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? (event) => handleRowActivate(event, row.original, onRowClick) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            // Space scrolls the page otherwise, and the row is
                            // the thing the user is pointing at.
                            event.preventDefault();
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                    className={clsx(
                      "transition-colors",
                      onRowClick && "cursor-pointer focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                      selected
                        ? "bg-brand-50/80 hover:bg-brand-50"
                        : "hover:bg-slate-50/70",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Shown even when the page is empty: a total of zero is the answer
              to "did my filter work", and the source loses it precisely then. */}
          {footer && !isLoading && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
              <tr>
                {columns.map((column, index) => (
                  <td
                    key={column.id ?? index}
                    className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-800"
                  >
                    {column.id ? footer[column.id] : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
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
