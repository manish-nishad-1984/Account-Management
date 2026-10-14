import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { SavedBalanceSheetRow } from "@accountmanagement/contracts";
import { Eye, Plus } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import { exportAmount, exportDate, type ExportColumn } from "../../lib/grid-export";
import { Button, ConfirmDialog, IconButton, PageHeader, SelectField } from "../../components/ui";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions } from "../purchase-orders/api";
import { useDeleteBalanceSheet, useSavedBalanceSheets } from "./api";
import { BalanceSheetFormDialog } from "./BalanceSheetFormDialog";

/**
 * Balance Sheets - project-wise sheets the office made and kept, each for a
 * company, a range of income dates and a range of invoice dates (client request,
 * 14 Oct 2026). Newest first. The report under Reports shows the same sheet live;
 * these are kept as they were worked out.
 */
const SORTABLE = ["createdAt"] as const;

const Absent = () => <span className="text-slate-300">—</span>;

/** "01 Oct 2026 – 31 Oct 2026", "from 01 Oct 2026", "up to 31 Oct 2026", or "All dates". */
export function periodText(from: string | null, to: string | null): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `up to ${formatDate(to)}`;
  return "All dates";
}

const EXPORT_COLUMNS: ExportColumn<SavedBalanceSheetRow>[] = [
  { header: "Title", width: 28, value: (row) => row.title },
  { header: "Company", width: 28, value: (row) => row.companyName ?? "All companies" },
  { header: "Site", width: 28, value: (row) => row.siteName ?? "All sites" },
  { header: "Income from", width: 12, value: (row) => exportDate(row.incomeFrom) },
  { header: "Income to", width: 12, value: (row) => exportDate(row.incomeTo) },
  { header: "Invoice from", width: 12, value: (row) => exportDate(row.invoiceFrom) },
  { header: "Invoice to", width: 12, value: (row) => exportDate(row.invoiceTo) },
  { header: "Projects", width: 10, align: "right", value: (row) => row.projectCount },
  { header: "Income", width: 16, align: "right", value: (row) => exportAmount(row.figures.income) },
  { header: "Billed", width: 16, align: "right", value: (row) => exportAmount(row.figures.billed) },
  { header: "Paid", width: 16, align: "right", value: (row) => exportAmount(row.figures.paid) },
  { header: "Still to pay", width: 16, align: "right", value: (row) => exportAmount(row.figures.stillToPay) },
  { header: "Cash balance", width: 16, align: "right", value: (row) => exportAmount(row.figures.cashBalance) },
  { header: "Project result", width: 16, align: "right", value: (row) => exportAmount(row.figures.projectResult) },
  { header: "Saved on", width: 12, value: (row) => exportDate(row.createdAt) },
  { header: "Saved by", width: 22, value: (row) => row.createdByName },
];

const Money = ({ value, strong = false }: { value: string; strong?: boolean }) => (
  <span
    className={`tabular block text-right ${strong ? "font-semibold" : ""} ${Number(value) < 0 ? "text-rose-700" : "text-slate-900"}`}
  >
    {formatMoney(value)}
  </span>
);

export function BalanceSheetsPage() {
  const canAdd = usePermission("balance-sheets", "add");
  const screen = useMasterScreen<SavedBalanceSheetRow>({ defaultSortBy: "createdAt", defaultSortDir: "desc" });
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const companies = useCompanyOptions();
  const scope = useSiteScope();
  const filterValues = {
    companyId: companyId === "" ? undefined : companyId,
    siteId: siteId === "" ? undefined : siteId,
  };
  const query = useSavedBalanceSheets(screen.listParams, filterValues);
  const remove = useDeleteBalanceSheet();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<SavedBalanceSheetRow, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">{row.original.title ?? "Balance sheet"}</span>
        ),
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
        id: "site",
        header: "Site",
        cell: ({ row }) =>
          row.original.siteName ? (
            <span className="text-slate-700">{row.original.siteName}</span>
          ) : (
            <span className="text-slate-400">All sites</span>
          ),
      },
      {
        id: "income",
        header: "Income dates",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-slate-600">
            {periodText(row.original.incomeFrom, row.original.incomeTo)}
          </span>
        ),
      },
      {
        id: "invoices",
        header: "Invoice dates",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-slate-600">
            {periodText(row.original.invoiceFrom, row.original.invoiceTo)}
          </span>
        ),
      },
      {
        id: "projects",
        header: "Projects",
        meta: { align: "right" },
        cell: ({ row }) => <span className="tabular block text-right text-slate-700">{row.original.projectCount}</span>,
      },
      {
        id: "incomeAmount",
        header: "Income",
        meta: { align: "right" },
        cell: ({ row }) => <Money value={row.original.figures.income} />,
      },
      {
        id: "billed",
        header: "Billed",
        meta: { align: "right" },
        cell: ({ row }) => <Money value={row.original.figures.billed} />,
      },
      {
        id: "paid",
        header: "Paid",
        meta: { align: "right" },
        cell: ({ row }) => <Money value={row.original.figures.paid} />,
      },
      {
        id: "cashBalance",
        header: "Cash balance",
        meta: { align: "right" },
        cell: ({ row }) => <Money value={row.original.figures.cashBalance} strong />,
      },
      {
        id: "projectResult",
        header: "Project result",
        meta: { align: "right" },
        cell: ({ row }) => <Money value={row.original.figures.projectResult} strong />,
      },
      {
        id: "saved",
        header: "Saved",
        cell: ({ row }) => {
          const when = row.original.updatedAt ?? row.original.createdAt;
          const by = row.original.updatedAt ? row.original.updatedByName : row.original.createdByName;
          return (
            <span className="tabular whitespace-nowrap text-slate-700">
              {formatDateTime(when)}
              {by ? <span className="ml-2 text-xs text-slate-400">by {by}</span> : <Absent />}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const label = row.original.title ?? "balance sheet";
          return (
            <div className="flex items-center justify-end gap-0.5">
              {!row.original.capabilities.canEdit && (
                <IconButton label={`Open ${label}`} icon={Eye} tone="operation" onClick={() => openEdit(row.original.id)} className="size-9 lg:size-7" />
              )}
              <RowActions
                capabilities={row.original.capabilities}
                label={label}
                onEdit={() => openEdit(row.original.id)}
                onDelete={() => askDelete(row.original)}
              />
            </div>
          );
        },
      },
    ],
    [openEdit, askDelete],
  );

  // Whether the OPEN sheet may be changed comes from its row; the server still decides.
  const editingRow = query.data?.rows.find((row) => row.id === screen.editingId);
  const readOnly = screen.editingId !== null && !editingRow?.capabilities.canEdit;

  return (
    <>
      <PageHeader title="Balance Sheets" description="Project-wise sheets for a company and the dates you choose, kept" />

      <DataGrid<SavedBalanceSheetRow>
        filters={
          <>
          <SelectField
            labelHidden
            label="Site"
            value={siteId}
            options={[
              { value: "", label: "All sites" },
              ...scope.sites.map((row) => ({ value: row.id, label: row.name })),
            ]}
            onChange={(event) => setSiteId(event.target.value)}
          />
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
          </>
        }
        actions={
          <>
            <ExportExcelButton<SavedBalanceSheetRow>
              resource="balance-sheets"
              params={screen.listParams}
              filters={filterValues}
              columns={EXPORT_COLUMNS}
              sheetName="Balance sheets"
              fileName="Balance-sheets"
            />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                New balance sheet
              </Button>
            )}
          </>
        }
        gridKey="balance-sheets"
        columns={columns}
        searchPlaceholder="Search by title or company…"
        sortableFields={SORTABLE}
        emptyMessage="No balance sheets yet"
        {...screen.gridProps(query)}
      />

      <BalanceSheetFormDialog
        open={screen.isFormOpen}
        sheetId={screen.editingId}
        readOnly={readOnly}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete balance sheet"
        body={
          <p>
            Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.title ?? "this balance sheet"}</span>?
            Only the saved sheet is removed; no invoice, payment or income changes.
          </p>
        }
      />
    </>
  );
}
