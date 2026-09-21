import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import clsx from "clsx";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { GridColumnDefault, SortDirection } from "@accountmanagement/contracts";
import { ChevronLeft, ChevronRight, Columns3, Inbox, Search } from "lucide-react";
import { Button, EmptyState, TextField } from "../ui";
import { CustomizeColumns } from "./CustomizeColumns";
import { useGridPreferences } from "../../lib/grid-preferences";
import { useFitHeight } from "../../lib/use-fit-height";

/**
 * What to call a column in the customise panel.
 *
 * A header is usually a plain string and that is the answer. Two cases are not:
 * the row-actions column heads itself with an empty string, because a heading
 * over two icon buttons is noise — which listed it in the panel as "actions",
 * the raw id. And a header rendered as a component has no text at all. Both fall
 * back to the id, turned into words.
 */
function columnLabel(header: unknown, id: string): string {
  if (typeof header === "string" && header.trim() !== "") return header;
  const words = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];

  /**
   * Turns on per-person column choice for this grid, stored under this key.
   *
   * OPTIONAL, so a grid that has not opted in behaves exactly as it did before:
   * no button, no request, no stored state. The key is the screen slug and must
   * not change once people have saved layouts, because a layout is addressed by
   * it and a renamed key silently loses everyone their setup.
   */
  gridKey?: string;
  rows: T[];
  total: number | null;
  isLoading: boolean;
  error?: string | null;

  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /**
   * The screen's own filters, in the toolbar beside the search box, and its
   * actions (Add, Upload, a direction switch) at the right-hand end of it — one
   * row above the grid instead of three (client request, 18 Sep 2026).
   */
  filters?: ReactNode;
  actions?: ReactNode;

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
   * How many rows a page holds, and the sizes on offer.
   *
   * OPTIONAL AS A SET. `useMasterScreen.gridProps` supplies all three, so all
   * thirteen screens get the control with no edit of their own; a grid driven by
   * hand and passing none of them keeps a footer with just the pager in it,
   * which is what the width test renders.
   */
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;

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
  gridKey,
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
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  emptyMessage = "Nothing to show",
  footer,
  onRowClick,
  selectedRowId = null,
  filters,
  actions,
}: DataGridProps<T>) {
  // The label and the select are two elements in a grid that may be on screen
  // more than once, so the id cannot be a constant.
  const pageSizeId = useId();

  /**
   * What the customise panel lists, derived from the column definitions the
   * screen already passes rather than from a second list to keep in step.
   *
   * TWO COLUMNS ARE LOCKED: the first, because it says which row you are looking
   * at, and any column called "actions", because hiding Edit and Delete leaves a
   * grid you can read and cannot use. The reference design locks its first
   * column for the same reason.
   *
   * A header that is a render function has no text to show, so the id stands in.
   * Every grid here heads its columns with a plain string.
   */
  const defaults = useMemo<GridColumnDefault[]>(
    () =>
      columns.map((column, index) => {
        const id = String(column.id ?? "");
        /**
         * A column may declare itself hidden until asked for:
         * `meta: { defaultHidden: true }`.
         *
         * That is how a field already on the wire gets offered without changing
         * any grid the day it ships. Adding a column that everyone suddenly sees
         * is a change to everyone's screen; adding one they can switch on is not.
         */
        const meta = column.meta as { defaultHidden?: boolean } | undefined;
        return {
          id,
          label: columnLabel(column.header, id),
          visible: meta?.defaultHidden !== true,
          locked: index === 0 || id === "actions",
        };
      }),
    [columns],
  );

  const preferences = useGridPreferences(gridKey ?? "", defaults);
  const [customising, setCustomising] = useState(false);

  /**
   * The columns actually rendered: the chosen order, minus what was hidden.
   *
   * Done here rather than through the table's own `columnVisibility` and
   * `columnOrder` state because the footer row and the loading skeleton below
   * both iterate `columns` directly. Handing the table a list that already
   * matches what is on screen keeps all three in agreement; two sources would
   * eventually disagree by one column and nobody could tell which was right.
   */
  const effectiveColumns = useMemo(() => {
    if (!gridKey) return columns;
    const byId = new Map(columns.map((column) => [String(column.id ?? ""), column]));
    return preferences.columns
      .filter((column) => column.visible)
      .map((column) => byId.get(column.id))
      .filter((column): column is ColumnDef<T, unknown> => column !== undefined);
  }, [columns, gridKey, preferences.columns]);

  const table = useReactTable({
    data: rows,
    columns: effectiveColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  /**
   * THE ROW ACTIONS ARE PINNED TO THE RIGHT EDGE while the table scrolls, and
   * the shadow that separates them appears only while there is something left
   * to scroll to.
   *
   * A grid that fits needs no floating column and no shadow over nothing; one
   * that does not fit must never push Edit and Delete off the screen, which is
   * what made the sideways scrolling worth reporting rather than merely
   * untidy. `scrollLeft` is watched rather than assumed: the same grid fits or
   * does not depending on the window, the sidebar and which columns the reader
   * chose to show.
   *
   * A resize listener, not a ResizeObserver: the container only changes width
   * when the window does or when the columns change, and the latter re-runs
   * this effect anyway.
   */
  /*
    The same box scrolls both ways: sideways for wide column sets, and down
    within the height left on the page, so the page itself never scrolls and its
    scrollbar never stands beside this one (client request, 18 Sep 2026). The
    header row and any totals row stay pinned while the rows move.
  */
  const fitted = useFitHeight();
  const scrollerRef = fitted.ref;
  const [scrollAtEnd, setScrollAtEnd] = useState(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () =>
      setScrollAtEnd(el.scrollWidth - el.clientWidth - el.scrollLeft <= 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [effectiveColumns.length, rows.length, isLoading]);

  /** The last column, when it is the row actions, is the one that floats. */
  const stickyColumnId =
    effectiveColumns.at(-1)?.id === "actions" ? "actions" : null;
  const stickyCell = (isSticky: boolean, background: string, layer = "z-10") =>
    isSticky && [
      "sticky right-0",
      layer,
      background,
      !scrollAtEnd && "shadow-[-6px_0_10px_-6px_rgba(15,23,42,0.18)]",
    ];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      {/*
        THE LIST TOOLBAR, and it is the same shape on every list screen: what you
        are looking for on the left, what you are looking at on the right.

        The search box is the shared `TextField`, not a hand-rolled input. It was
        the latter, 4px taller than every other control in the application and
        with its own radius, which is exactly the drift a design system exists to
        prevent - and it cost a label, since it had only an `aria-label` where
        every other field here has a real `<label>`.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <TextField
            label="Search"
            labelHidden
            icon={Search}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            className={filters ? "w-full sm:w-48" : "w-full sm:w-72"}
          />
          {/* Each filter one width, so three of them and the actions still share a line at 1366px. */}
          {filters && <div className="flex flex-wrap items-center gap-3 [&_select]:w-40">{filters}</div>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {gridKey && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Columns3}
              onClick={() => setCustomising(true)}
            >
              Columns
            </Button>
          )}
          {total !== null && (
            <span data-testid="record-count" className="text-sm text-slate-500">
              <span className="tabular font-medium text-slate-700">{total}</span>{" "}
              {total === 1 ? "record" : "records"}
            </span>
          )}
          {actions}
        </div>
      </div>

      {gridKey && (
        <CustomizeColumns
          open={customising}
          columns={preferences.columns}
          isSaving={preferences.isSaving}
          onCancel={() => setCustomising(false)}
          onSave={(next) => {
            void preferences.save(next).finally(() => setCustomising(false));
          }}
          onReset={() => {
            void preferences.reset().finally(() => setCustomising(false));
          }}
        />
      )}

      {error && (
        <div role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/*
        `relative` IS LOAD BEARING, and it is not about positioning anything.

        A hidden label is `position: absolute` — that is what `sr-only` is — and
        an absolutely positioned element is laid out against its nearest
        POSITIONED ancestor, not its nearest scrolling one. With no positioned
        ancestor, the `sr-only` labels inside a 52rem line grid resolved against
        the page itself, landed at x=486, and were not clipped by this scroller
        at all: on a 390px phone the whole DOCUMENT scrolled sideways by 97px to
        reach three invisible 1px labels. Measured on the purchase order record
        page, where nothing visible was out of place — which is what made it hard
        to see.

        Making the scroller positioned puts them back inside it, where they
        scroll with the table they belong to. Every horizontal scroller in the
        application carries this for the same reason.
      */}
      <div ref={scrollerRef} className="relative overflow-auto" style={{ maxHeight: fitted.height }}>
        {/*
          13px and a 40px row. The grids this replaces run to twelve columns, and
          the 44px rows they started at meant eight records to a laptop screen -
          for a screen whose whole job is comparing one row with another.
        */}
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-surface-muted">
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
                      className={clsx(
                        "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.05em] text-slate-500",
                        // Pinned to the top; the actions header is pinned right as well, above both.
                        "sticky top-0 bg-surface-muted shadow-[inset_0_-1px_0_var(--color-slate-200)]",
                        field === stickyColumnId ? stickyCell(true, "bg-surface-muted", "z-30") : "z-20",
                      )}
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
                            "-my-2.5 inline-flex items-center gap-1 py-2.5 hover:text-slate-800",
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
                  {effectiveColumns.map((_, cellIndex) => (
                    // A skeleton ROW, at the height of a real one, so the table
                    // does not jump by 40px per row when the data lands.
                    <td key={cellIndex} className="px-4 py-2.5">
                      <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={effectiveColumns.length}>
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
                    /*
                      SOLID TINTS, not the 80% and 70% these were. The row
                      actions float above the scrolling cells and must paint
                      their own background; a translucent one there blends
                      with what passes underneath and leaves a visible seam
                      down the edge of the table.
                    */
                    className={clsx(
                      "group transition-colors",
                      onRowClick && "cursor-pointer focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                      selected ? "bg-brand-50 hover:bg-brand-50" : "hover:bg-slate-50",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={clsx(
                          "px-4 py-2.5 text-slate-600",
                          stickyCell(
                            cell.column.id === stickyColumnId,
                            selected
                              ? "bg-brand-50"
                              : "bg-white group-hover:bg-slate-50",
                          ),
                        )}
                      >
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
            <tfoot className="border-t-2 border-slate-200 bg-surface-muted">
              <tr>
                {effectiveColumns.map((column, index) => (
                  <td
                    key={column.id ?? index}
                    className={clsx(
                      "whitespace-nowrap px-4 py-2.5 text-sm font-semibold text-slate-800",
                      "sticky bottom-0 bg-surface-muted shadow-[inset_0_2px_0_var(--color-slate-200)]",
                      column.id === stickyColumnId ? stickyCell(true, "bg-surface-muted", "z-30") : "z-20",
                    )}
                  >
                    {column.id ? footer[column.id] : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 bg-surface-muted px-4 py-2">
        <div className="flex items-center gap-3">
          {/*
            HOW MANY ROWS, asked for on 16 Sep 2026 and answered here rather than
            on thirteen screens - the same property that made the redesign cheap.

            It sits with the pager because that is the one control it changes the
            meaning of: pick 100 and "Page 2" is a different set of rows than it
            was a moment ago. Next to the search box, which is the other place it
            could go, it would read as a filter.
          */}
          {onPageSizeChange && pageSize !== undefined && pageSizeOptions && (
            <div className="flex items-center gap-1.5">
              <label htmlFor={pageSizeId} className="text-sm text-slate-500">
                Rows
              </label>
              <select
                id={pageSizeId}
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                className="tabular h-8 rounded-md border-0 bg-white py-0 pl-2 pr-7 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 transition-shadow focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          )}

          <span className="text-sm text-slate-500">
            Page <span className="tabular font-medium text-slate-700">{pageIndex + 1}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronLeft}
            disabled={!canGoBack}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={!canGoForward} onClick={onNext}>
            Next
            <ChevronRight aria-hidden className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
