import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ListResponse, RowCapabilities } from "@accountmanagement/contracts";
import { AlertTriangle, ArrowRight, Check, CheckCircle2 } from "lucide-react";
import { Button, Card } from "../../components/ui";
import { describeApproved, useBulkApproval } from "./approvals";
import { usePermission } from "../../lib/permissions";

/** Every queue row is addressable and carries what the caller may do to it. */
export interface QueueRow {
  id: string;
  capabilities: RowCapabilities;
}

export interface QueueColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Numbers right-align; everything else reads left. */
  numeric?: boolean;
}

interface ApprovalQueueProps<T extends QueueRow> {
  title: string;
  /** The permission subject — `item`, `supplier`, `inward-challan`. */
  subject: string;
  /** The API segment, for `POST /<resource>/approvals`. */
  resource: string;
  /** Where "View all" goes. */
  to: string;
  columns: QueueColumn<T>[];
  query: UseQueryResult<ListResponse<T>>;
  /**
   * False while something the query depends on is still resolving — the site
   * scope, typically. A queue that does not know it is waiting announces "no
   * rows" for a site it has not asked about yet.
   */
  ready?: boolean;
}

/**
 * One pending-approval panel of the dashboard.
 *
 * The legacy `/Home/Index` is six of these in a 2x3 grid, and the detail that
 * matters is that **the Approve column header is itself a checkbox** — select
 * all, then one bulk action. That is the entry point for
 * `MultiplePurchaseRequestIsApproved` and its five siblings, every one of which
 * carried finding P2: they loaded the whole table and called `Update()` on every
 * row, so approving three rows issued an UPDATE against all of them and
 * clobbered any concurrent edit. The endpoint behind this button is one
 * statement over the named ids.
 */
export function ApprovalQueue<T extends QueueRow>({
  title,
  subject,
  resource,
  to,
  columns,
  query,
  ready = true,
}: ApprovalQueueProps<T>) {
  const canApprove = usePermission(subject, "approve");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const approve = useBulkApproval(resource);
  const headerBox = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const total = query.data?.total ?? 0;
  const loading = query.isLoading || !ready;

  // Rows that may actually be approved. A row whose capabilities say otherwise
  // must not be swept up by select-all — the server would refuse it and the
  // count would silently disagree with the tick marks.
  const approvable = useMemo(() => rows.filter((row) => row.capabilities.canApprove), [rows]);

  /**
   * Selection is dropped whenever the underlying rows change.
   *
   * Ids survive a refetch, so keeping them would mean a select-all made before
   * an approval still names rows that have since left the queue. Harmless
   * against the server, which skips them, but the count it reports would then
   * not match what the person ticked.
   */
  useEffect(() => {
    setSelected(new Set());
  }, [query.dataUpdatedAt]);

  const allSelected = approvable.length > 0 && selected.size === approvable.length;
  const someSelected = selected.size > 0 && !allSelected;

  // `indeterminate` is a property, not an attribute — React cannot set it in JSX.
  useEffect(() => {
    if (headerBox.current) {
      headerBox.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleAll = () => {
    setNotice(null);
    setSelected(allSelected ? new Set() : new Set(approvable.map((row) => row.id)));
  };

  const toggleOne = (id: string) => {
    setNotice(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    const result = await approve
      .mutateAsync({ ids: [...selected], isApproved: true })
      .catch(() => null);
    if (result) {
      setNotice(describeApproved(result));
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="heading text-sm">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? "Loading…" : `${total} awaiting approval`}
          </p>
        </div>
        {canApprove && selected.size > 0 && (
          <Button icon={Check} onClick={submit} loading={approve.isPending}>
            Approve {selected.size}
          </Button>
        )}
      </div>

      {notice && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-100">
          <CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
          {notice}
        </p>
      )}

      {approve.isError && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-100">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          {approve.error instanceof Error ? approve.error.message : "The approval failed."}
        </p>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="py-6 text-center text-sm text-slate-500">Could not load this queue.</p>
      ) : rows.length === 0 ? (
        // The legacy wording, deliberately: "criteria", because the panels
        // honour the header's site selector and an empty panel usually means
        // the filter rather than an empty system.
        <p className="py-6 text-center text-sm text-slate-500">
          No data found for the selected criteria
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                {canApprove && (
                  <th scope="col" className="w-8 px-1 py-2">
                    {/*
                      The header checkbox IS the select-all — the legacy screen's
                      one genuinely unusual control, and the entry point for the
                      bulk action.
                    */}
                    <input
                      ref={headerBox}
                      type="checkbox"
                      className="size-3.5 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={approvable.length === 0}
                      aria-label={`Select all ${title.toLowerCase()}`}
                    />
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-1 py-2 font-medium ${column.numeric ? "text-right" : ""}`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row) => (
                <tr key={row.id}>
                  {canApprove && (
                    <td className="px-1 py-2">
                      <input
                        type="checkbox"
                        className="size-3.5 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        disabled={!row.capabilities.canApprove}
                        aria-label={`Select row ${row.id}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-1 py-2 text-slate-700 ${column.numeric ? "tabular text-right" : ""}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Link
        to={to}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700"
      >
        View all
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </Card>
  );
}
