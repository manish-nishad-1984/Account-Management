import { useCallback, useState } from "react";
import { DEFAULT_PAGE_SIZE, type ListResponse, type SortDirection } from "@accountmanagement/contracts";
import { ApiError } from "./api-client";
import type { ListParams } from "./list-query";
import { useRecordLayout } from "../contexts/RecordLayoutContext";

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
  pageSize?: number;
}

export function useMasterScreen<TRow extends { id: string | number }>({
  defaultSortBy,
  defaultSortDir = "asc",
  pageSize = DEFAULT_PAGE_SIZE,
}: MasterScreenOptions) {
  const { layout } = useRecordLayout();
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
    canGoBack: cursors.length > 0,
    canGoForward: Boolean(query.data?.nextCursor),
    onPrevious: () => setCursors((stack) => stack.slice(0, -1)),
    onNext: () => {
      const next = query.data?.nextCursor;
      if (next) setCursors((stack) => [...stack, next]);
    },

    /**
     * ONLY in the split layout. With a modal, a click anywhere in a row would
     * throw a blocking dialog over the list — the exact behaviour the legacy
     * screens do not have and the reason this comparison exists.
     */
    onRowClick: layout === "split" ? (row: TRow) => setFormTarget({ id: String(row.id) }) : undefined,
    /**
     * Marking the open record only makes sense when it is visible beside the
     * list. Under a modal the highlight is hidden by the dialog and then
     * lingers, unexplained, after it closes.
     */
    selectedRowId: layout === "split" ? (formTarget?.id ?? null) : null,
  });

  return {
    listParams,
    gridProps,
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
