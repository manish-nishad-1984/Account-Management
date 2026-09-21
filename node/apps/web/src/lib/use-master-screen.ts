import { useCallback, useState } from "react";
import { type ListResponse, type SortDirection } from "@accountmanagement/contracts";
import { ApiError } from "./api-client";
import type { ListParams } from "./list-query";
import { useRecordLayout } from "../contexts/RecordLayoutContext";
import { DEFAULT_GRID_PAGE_SIZE, PAGE_SIZE_OPTIONS, useGridPageSize } from "./page-size";

/**
 * The state every master screen has: search, sort, a cursor stack, which record
 * is being edited, and which is queued for deletion.
 *
 * Extracted for the same reason `useListResource` was. Five screens repeating
 * this by hand is how the .NET app finished with 19 grids that behave 19
 * different ways — and the specific bugs that produces are predictable: forgetting
 * to reset paging when the search changes (page 3 of the old result set, showing
 * nothing), or leaving the edit target set after the dialog closes (the next
 * "Add" opens as an edit of whatever was last touched).
 */

export interface MasterScreenOptions {
  /** Must be one of the resource's sortable fields, and NOT NULL in the database. */
  defaultSortBy: string;
  defaultSortDir?: SortDirection;
  /**
   * The page this screen opens at when the reader has never chosen one.
   *
   * A CHOICE THEY HAVE MADE ALWAYS WINS. This is the fallback, not a cap - a
   * screen passing 50 here still gets 20 from someone who set 20 on the screen
   * before, which is the point of the setting.
   */
  pageSize?: number;
}

export function useMasterScreen<TRow extends { id: string | number }>({
  defaultSortBy,
  defaultSortDir = "asc",
  pageSize: initialPageSize = DEFAULT_GRID_PAGE_SIZE,
}: MasterScreenOptions) {
  const { layout } = useRecordLayout();
  const { pageSize, setPageSize } = useGridPageSize(initialPageSize);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultSortDir);
  const [cursors, setCursors] = useState<string[]>([]);

  /** null = closed. `{ id: null }` = create. `{ id }` = edit. */
  const [formTarget, setFormTarget] = useState<{ id: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listParams: ListParams = {
    limit: pageSize,
    cursor: cursors[cursors.length - 1],
    sortBy,
    sortDir,
    search: search.trim() || undefined,
  };

  /**
   * Any change to the result SET has to start from page 1 again. A cursor
   * encodes a position in one ordering of one filter; carried across a change to
   * either, it points into a sequence that no longer exists — and keyset paging
   * gives no error for that, just a page of rows from nowhere in particular.
   */
  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setCursors([]);
  }, []);

  /**
   * Back to page one, for a screen that changes the result set some way other
   * than search or sort — the inward-challan filters are the first.
   *
   * Same reasoning as `changeSearch`: a cursor encodes a position in ONE ordering
   * of ONE filter, and carried across a change to either it seeks into a
   * sequence that no longer exists. Keyset paging gives no error for that, just
   * a page of rows from nowhere in particular.
   */
  const resetPaging = useCallback(() => setCursors([]), []);

  /**
   * A NEW PAGE SIZE MEANS PAGE ONE, for the same reason a new search does.
   *
   * A cursor is a position in a sequence cut into pages of a particular size.
   * Ask for 100 rows while holding a cursor taken from a run of 20 and the
   * server answers honestly with 100 rows starting from that row - which is
   * neither page 1 nor page 4 of the new pagination, and the pager underneath it
   * would be counting something that does not exist. Keyset paging reports no
   * error for this; it just returns rows from nowhere in particular.
   */
  const changePageSize = useCallback(
    (size: number) => {
      setPageSize(size);
      setCursors([]);
    },
    [setPageSize],
  );

  const changeSort = useCallback((field: string, direction: SortDirection) => {
    setSortBy(field);
    setSortDir(direction);
    setCursors([]);
  }, []);

  const openCreate = useCallback(() => setFormTarget({ id: null }), []);
  const openEdit = useCallback((id: string) => setFormTarget({ id }), []);
  const closeForm = useCallback(() => setFormTarget(null), []);

  const askDelete = useCallback((row: TRow) => {
    setDeleteError(null);
    setDeleteTarget(row);
  }, []);
  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  /**
   * Runs the delete and keeps the dialog OPEN on refusal.
   *
   * Deletes here are refused for reasons worth reading — "this company still has
   * 20 assigned users" — so the refusal belongs in front of the person who asked,
   * not in a toast that outlives the dialog by three seconds.
   */
  const runDelete = useCallback(
    async (remove: (id: string | number) => Promise<unknown>) => {
      if (!deleteTarget) return;
      setDeleteError(null);
      try {
        await remove(deleteTarget.id);
        setDeleteTarget(null);
      } catch (error) {
        setDeleteError(
          error instanceof ApiError ? error.message : "Could not delete this record",
        );
      }
    },
    [deleteTarget],
  );

  /**
   * The paging and sorting half of DataGrid's props, so screens spread one object.
   *
   * The split-layout behaviour rides in here rather than being added to twelve
   * pages: every screen already spreads this, so row-click-to-open and the
   * selected-row highlight arrive with no page edit at all. That is the same
   * property that makes the layout question cheap to answer now and expensive to
   * answer later.
   */
  const gridProps = (query: {
    data?: ListResponse<TRow>;
    isLoading: boolean;
    error: unknown;
  }) => ({
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? null,
    isLoading: query.isLoading,
    error: query.error
      ? query.error instanceof ApiError
        ? query.error.message
        : "Could not load this list"
      : null,
    search,
    onSearchChange: changeSearch,
    sortBy,
    sortDir,
    onSortChange: changeSort,
    pageIndex: cursors.length,
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onPageSizeChange: changePageSize,
    canGoBack: cursors.length > 0,
    canGoForward: Boolean(query.data?.nextCursor),
    onPrevious: () => setCursors((stack) => stack.slice(0, -1)),
    onNext: () => {
      const next = query.data?.nextCursor;
      if (next) setCursors((stack) => [...stack, next]);
    },

    /**
     * NOT under a modal. A click anywhere in a row would throw a blocking dialog
     * over the list — the exact behaviour the legacy screens do not have and the
     * reason this comparison exists.
     *
     * Both other layouts take it, for the same reason from opposite directions:
     * the split pane fills beside a list that stays readable, and the full page
     * is a drill-down that has a back arrow to return by. Neither traps the user
     * behind a backdrop they did not ask for.
     */
    onRowClick:
      layout === "modal" ? undefined : (row: TRow) => setFormTarget({ id: String(row.id) }),
    /**
     * Marking the open record only makes sense when it is visible beside the
     * list. Under a modal the highlight is hidden by the dialog and then
     * lingers, unexplained, after it closes — and under the full page the list
     * is not on screen at all while the record is open, and the target is
     * already cleared by the time it comes back.
     */
    selectedRowId: layout === "split" ? (formTarget?.id ?? null) : null,
  });

  return {
    listParams,
    gridProps,
    pageSize,
    formTarget,
    isFormOpen: formTarget !== null,
    editingId: formTarget?.id ?? null,
    resetPaging,
    openCreate,
    openEdit,
    closeForm,
    deleteTarget,
    deleteError,
    askDelete,
    cancelDelete,
    runDelete,
  };
}
