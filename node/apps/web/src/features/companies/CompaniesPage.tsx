import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { COMPANY_SORT_FIELDS, type CompanyRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useCompanyList, useDeleteCompany } from "./api";
import { CompanyFormDialog } from "./CompanyFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

/** Renders a value that the source data is allowed to be missing, without lying. */
const Absent = () => <span className="text-slate-300">—</span>;

export function CompaniesPage() {
  const canAdd = usePermission("company", "add");
  const screen = useMasterScreen<CompanyRow>({ defaultSortBy: "name" });
  const query = useCompanyList(screen.listParams);
  const remove = useDeleteCompany();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<CompanyRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Company",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.name}</div>
            <div className="tabular text-xs text-slate-500">
              {row.original.panNo ?? "PAN not recorded"}
            </div>
          </div>
        ),
      },
      {
        id: "gstNo",
        header: "GST number",
        cell: ({ row }) =>
          row.original.gstNo ? (
            <span className="tabular text-slate-600">{row.original.gstNo}</span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "invoicePrefix",
        header: "Invoice prefix",
        cell: ({ row }) =>
          row.original.invoicePrefix ? (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium tracking-wide text-slate-600">
              {row.original.invoicePrefix}
            </span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "area",
        header: "Location",
        cell: ({ row }) =>
          row.original.area || row.original.pincode ? (
            <div>
              <div className="text-slate-700">{row.original.area ?? ""}</div>
              <div className="tabular text-xs text-slate-500">{row.original.pincode ?? ""}</div>
            </div>
          ) : (
            <Absent />
          ),
      },
      {
        id: "bankName",
        header: "Bank",
        cell: ({ row }) =>
          row.original.bankName ? (
            <span className="text-slate-600">{row.original.bankName}</span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "userCount",
        header: "Users",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Users assigned to this company"
          >
            {row.original.userCount}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions
            capabilities={row.original.capabilities}
            label={row.original.name}
            onEdit={() => openEdit(row.original.id)}
            onDelete={() => askDelete(row.original)}
          />
        ),
      },
    ],
    [openEdit, askDelete],
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description="Billing entities — GST registration, invoice prefix and bank details"
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add company
            </Button>
          ) : undefined
        }
      />

      <DataGrid<CompanyRow>
        gridKey="companies"
        columns={columns}
        searchPlaceholder="Search name, GST or PAN"
        sortableFields={COMPANY_SORT_FIELDS}
        emptyMessage="No companies match this search"
        {...screen.gridProps(query)}
      />

      <CompanyFormDialog
        open={screen.isFormOpen}
        companyId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete company"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            {/*
              Say what a delete here actually does. It is a soft delete — the row
              is flagged, not removed — and it is refused outright while users
              are still assigned, which is worth knowing before clicking rather
              than after.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The company is marked deleted and hidden from every list. Historic
              invoices that reference it are unaffected.
            </p>
          </>
        }
      />
    </>
  );
}
