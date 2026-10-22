import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { PayoutListRow } from "@accountmanagement/contracts";
import { Copy, Eye, FileSpreadsheet, Image as ImageIcon, Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { exportAmount, exportDate, type ExportColumn } from "../../lib/grid-export";
import { Badge, Button, ConfirmDialog, IconButton, PageHeader, SelectField } from "../../components/ui";
import { useCompanyOptions } from "../purchase-orders/api";
import { formatDateTime, formatMoney } from "../../lib/format";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useDeletePayoutList, usePayoutLists } from "./api";
import { PayoutListFormDialog } from "./PayoutListFormDialog";
import { PayoutExportButton } from "./PayoutExportButton";
import { formatListDate } from "./message";
import { PayoutImageDialog, ShareNotice, usePayoutSharing } from "./share";

/**
 * Payout Lists - what the owner decided to pay out, kept so it can be asked for
 * again and sent (client request, 5 Oct 2026).
 *
 * A list is a plan. Nothing on this screen creates a payment; the payment is
 * still keyed on Payments.
 *
 * NEWEST FIRST, by the day the list is FOR (`listDate`), not the day it was
 * typed: a list made on Friday for Monday belongs with Monday's.
 */
const SORTABLE = ["listDate"] as const;

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column — the screen's own columns, as text. */
export const EXPORT_COLUMNS: ExportColumn<PayoutListRow>[] = [
  { header: "Date", width: 12, value: (row) => exportDate(row.listDate) },
  { header: "Title", width: 30, value: (row) => row.title },
  { header: "Company", width: 28, value: (row) => row.companyName },
  { header: "Status", width: 12, value: (row) => (row.status === "confirmed" ? "Confirmed" : "Draft") },
  { header: "Parties", width: 10, align: "right", value: (row) => row.partyCount },
  { header: "Budget", width: 16, align: "right", value: (row) => exportAmount(row.budget) },
  { header: "Total", width: 16, align: "right", value: (row) => exportAmount(row.total) },
  { header: "Confirmed on", width: 12, value: (row) => exportDate(row.confirmedAt) },
  { header: "Created on", width: 12, value: (row) => exportDate(row.createdAt) },
  { header: "Created by", width: 22, value: (row) => row.createdByName },
  { header: "Last updated", width: 12, value: (row) => exportDate(row.updatedAt) },
  { header: "Updated by", width: 22, value: (row) => row.updatedByName },
];

export function PayoutListsPage() {
  const canAdd = usePermission("payout", "add");
  const screen = useMasterScreen<PayoutListRow>({ defaultSortBy: "listDate", defaultSortDir: "desc" });
  const [companyId, setCompanyId] = useState("");
  const companies = useCompanyOptions();
  const filterValues = { companyId: companyId === "" ? undefined : companyId };
  const query = usePayoutLists(screen.listParams, filterValues);
  const remove = useDeletePayoutList();
  const share = usePayoutSharing();

  const { openEdit, askDelete } = screen;
  const { showImage, copy, exportExcel, prefetch } = share;

  const columns = useMemo<ColumnDef<PayoutListRow, unknown>[]>(
    () => [
      {
        id: "listDate",
        header: "Date",
        cell: ({ row }) => (
          <span className="tabular font-medium text-slate-900">{formatListDate(row.original.listDate)}</span>
        ),
      },
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => (row.original.title ? <span className="text-slate-700">{row.original.title}</span> : <Absent />),
      },
      {
        id: "company",
        header: "Company",
        cell: ({ row }) =>
          row.original.companyName ? (
            <span className="text-slate-700">{row.original.companyName}</span>
          ) : (
            <span className="text-slate-400">All companies</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.status === "confirmed" ? (
            <Badge tone="success" dot>
              Confirmed
            </Badge>
          ) : (
            <Badge>Draft</Badge>
          ),
      },
      {
        id: "partyCount",
        header: "Parties",
        meta: { align: "right" },
        cell: ({ row }) => <span className="tabular block text-right text-slate-700">{row.original.partyCount}</span>,
      },
      {
        id: "budget",
        header: "Budget",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.budget ? (
            <span className="tabular block text-right text-slate-600">{formatMoney(row.original.budget)}</span>
          ) : (
            <span className="block text-right">
              <Absent />
            </span>
          ),
      },
      {
        id: "total",
        header: "Total",
        meta: { align: "right" },
        cell: ({ row }) => {
          // Amber when the list goes past what the owner said he could spend:
          // the figure that matters is read at a glance, not worked out.
          const over = row.original.budget !== null && Number(row.original.total) > Number(row.original.budget);
          return (
            <span
              title={over ? "More than the budget" : undefined}
              className={`tabular block text-right font-semibold ${over ? "text-amber-700" : "text-slate-900"}`}
            >
              {formatMoney(row.original.total)}
            </span>
          );
        },
      },
      {
        id: "updated",
        header: "Last updated",
        cell: ({ row }) => {
          const when = row.original.updatedAt ?? row.original.createdAt;
          const by = row.original.updatedAt ? row.original.updatedByName : row.original.createdByName;
          // One line: the grid's rows were 61px tall for two short lines each.
          return (
            <span className="tabular whitespace-nowrap text-slate-700">
              {formatDateTime(when)}
              {by && (
                <span className="ml-2 text-xs text-slate-400">
                  by <span>{by}</span>
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const { id, capabilities } = row.original;
          const label = row.original.title ?? formatListDate(row.original.listDate);
          return (
            // Warming the list's detail as the pointer or focus arrives keeps the
            // image click inside its user gesture; see `usePayoutDetailLoader`.
            <div
              className="flex items-center justify-end gap-2 lg:gap-1"
              onPointerEnter={() => prefetch(id)}
              onFocus={() => prefetch(id)}
            >
              {(!capabilities.canEdit || row.original.status === "confirmed") && (
                <IconButton label={`Open ${label}`} icon={Eye} tone="operation" onClick={() => openEdit(id)} className="size-9 lg:size-7" />
              )}
              <IconButton
                label={`View ${label} as image`}
                icon={ImageIcon}
                tone="operation"
                onClick={() => void showImage(id)}
                className="size-9 lg:size-7"
              />
              <IconButton label={`Copy ${label} text`} icon={Copy} onClick={() => void copy(id)} className="size-9 lg:size-7" />
              <IconButton
                label={`Export ${label} to Excel`}
                icon={FileSpreadsheet}
                tone="operation"
                onClick={() => void exportExcel(id)}
                className="size-9 lg:size-7"
              />
              <RowActions
                capabilities={
                  row.original.status === "confirmed"
                    ? { ...capabilities, canEdit: false, canDelete: false }
                    : capabilities
                }
                label={label}
                onEdit={() => openEdit(id)}
                onDelete={() => askDelete(row.original)}
              />
            </div>
          );
        },
      },
    ],
    [openEdit, askDelete, showImage, copy, exportExcel, prefetch],
  );

  // Whether the OPEN list may be changed comes from its row; a row that has
  // paged out of view is not known to be editable, and the server still decides.
  const editingRow = query.data?.rows.find((row) => row.id === screen.editingId);
  const readOnly = screen.editingId !== null && !editingRow?.capabilities.canEdit;

  const target = screen.deleteTarget;
  const deleteName = target ? [target.title, formatListDate(target.listDate)].filter(Boolean).join(" - ") : "";

  return (
    <>
      <PageHeader title="Payout Lists" description="Who to pay, and how much of each" />
      <ShareNotice notice={share.notice} />
      <PayoutImageDialog share={share} />

      <DataGrid<PayoutListRow>
        filters={
          <SelectField
            labelHidden
            label="Company"
            value={companyId}
            options={[
              { value: "", label: "All companies" },
              ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
            ]}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        }
        actions={
          <>
            <PayoutExportButton params={screen.listParams} filters={filterValues} listColumns={EXPORT_COLUMNS} />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                New payout list
              </Button>
            )}
          </>
        }
        gridKey="payout-lists"
        columns={columns}
        searchPlaceholder="Search by title or party…"
        sortableFields={SORTABLE}
        emptyMessage="No payout lists match this search"
        {...screen.gridProps(query)}
      />

      <PayoutListFormDialog
        open={screen.isFormOpen}
        listId={screen.editingId}
        readOnly={readOnly}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete payout list"
        typeToConfirm={deleteName}
        body={
          <>
            <p>
              Delete the payout list{" "}
              <span className="font-medium text-slate-900">{deleteName}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Only the list is removed. No payment was made from it, so nothing in the ledger changes.
            </p>
          </>
        }
      />
    </>
  );
}
