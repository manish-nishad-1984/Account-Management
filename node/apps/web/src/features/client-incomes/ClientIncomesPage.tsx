import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CLIENT_INCOME_SORT_FIELDS, type ClientIncomeRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Button, ConfirmDialog, PageHeader, SelectField, SummaryStrip } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { formatDate, formatMoney } from "../../lib/format";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useCompanyOptions } from "../purchase-orders/api";
import { useClientIncomeList, useDeleteClientIncome } from "./api";
import { ClientIncomeFormDialog } from "./ClientIncomeFormDialog";

const Absent = () => <span className="text-slate-300">—</span>;

/**
 * Income (9 Oct 2026): what a project's client has paid us, part by part.
 * Held to the project in the header; the Final Total of the filtered entries is
 * summed under the title.
 */
export function ClientIncomesPage() {
  const canAdd = usePermission("income", "add");
  const scope = useSiteScope();
  const screen = useMasterScreen<ClientIncomeRow>({ defaultSortBy: "incomeDate", defaultSortDir: "desc" });
  const [companyId, setCompanyId] = useState("");
  const companies = useCompanyOptions();
  const query = useClientIncomeList(screen.listParams, { companyId });
  const remove = useDeleteClientIncome();

  const { openEdit, askDelete } = screen;

  const companyOptions = useMemo(
    () => [
      { value: "", label: "All companies" },
      ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
    ],
    [companies.data],
  );

  const columns = useMemo<ColumnDef<ClientIncomeRow, unknown>[]>(
    () => [
      {
        id: "incomeDate",
        header: "Date",
        cell: ({ row }) => (
          <span className="tabular font-medium text-slate-900">{formatDate(row.original.incomeDate)}</span>
        ),
      },
      {
        id: "client",
        header: "Client",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.clientName}</div>
            <div className="text-xs text-slate-500">{row.original.siteName}</div>
          </div>
        ),
      },
      {
        id: "company",
        header: "Received in",
        cell: ({ row }) => <span className="text-slate-700">{row.original.companyName}</span>,
      },
      {
        id: "amount",
        header: "Amount",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-700">{formatMoney(row.original.amount)}</span>
        ),
      },
      {
        id: "additional",
        header: "Additional",
        meta: { align: "right" },
        cell: ({ row }) =>
          Number(row.original.additionalTotal) > 0 ? (
            <span className="tabular block text-right text-emerald-700">+ {formatMoney(row.original.additionalTotal)}</span>
          ) : (
            <span className="block text-right">
              <Absent />
            </span>
          ),
      },
      {
        id: "deduction",
        header: "Deduction",
        meta: { align: "right" },
        cell: ({ row }) =>
          Number(row.original.deductionTotal) > 0 ? (
            <span className="tabular block text-right text-rose-700">− {formatMoney(row.original.deductionTotal)}</span>
          ) : (
            <span className="block text-right">
              <Absent />
            </span>
          ),
      },
      {
        id: "total",
        header: "Final total",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular block text-right font-semibold text-slate-900">{formatMoney(row.original.total)}</span>
        ),
      },
      {
        id: "method",
        header: "Method",
        cell: ({ row }) =>
          row.original.method || row.original.referenceNo ? (
            <div>
              <div className="text-slate-700">{row.original.method ?? ""}</div>
              <div className="tabular text-xs text-slate-500">{row.original.referenceNo ?? ""}</div>
            </div>
          ) : (
            <Absent />
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions
            capabilities={row.original.capabilities}
            label={`${row.original.clientName} ${formatDate(row.original.incomeDate)}`}
            onEdit={() => openEdit(row.original.id)}
            onDelete={() => askDelete(row.original)}
          />
        ),
      },
    ],
    [openEdit, askDelete],
  );

  const target = screen.deleteTarget;

  return (
    <>
      <PageHeader title="Income" description="What the project's client has paid us, entry by entry" />

      <SummaryStrip
        items={[
          { label: "Project", value: scope.siteName ?? "All projects" },
          { label: "Entries", value: String(query.data?.total ?? 0) },
          { label: "Final total", value: formatMoney(query.data?.totalAmount ?? "0"), strong: true },
        ]}
      />

      <DataGrid<ClientIncomeRow>
        filters={
          <SelectField
            labelHidden
            label="Company"
            value={companyId}
            options={companyOptions}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        }
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Record income
            </Button>
          ) : undefined
        }
        gridKey="client-incomes"
        columns={columns}
        searchPlaceholder="Search client, project or reference"
        sortableFields={CLIENT_INCOME_SORT_FIELDS}
        emptyMessage={scope.siteName ? `No income recorded for ${scope.siteName} yet` : "No income recorded yet"}
        {...screen.gridProps(query)}
      />

      <ClientIncomeFormDialog open={screen.isFormOpen} incomeId={screen.editingId} onClose={screen.closeForm} />

      <ConfirmDialog
        open={target !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete income entry"
        body={
          <>
            <p>
              Delete the entry of{" "}
              <span className="font-medium text-slate-900">
                {target ? `${formatMoney(target.total)} from ${target.clientName}` : ""}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              It is removed from the totals and the balance sheet. The record is kept, not erased.
            </p>
          </>
        }
      />
    </>
  );
}
