import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SUPPLIER_SORT_FIELDS, type SupplierRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import { exportAmount, exportYesNo, type ExportColumn } from "../../lib/grid-export";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSupplier, useSupplierList } from "./api";
import { SupplierFormDialog } from "./SupplierFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatMoney } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column — the screen's own columns, as text. */
export const EXPORT_COLUMNS: ExportColumn<SupplierRow>[] = [
  { header: "Supplier", width: 34, value: (row) => row.name },
  { header: "Email", width: 30, value: (row) => row.email },
  { header: "Mobile", width: 14, value: (row) => row.mobile },
  { header: "GST number", width: 18, value: (row) => row.gstNo },
  { header: "Area", width: 20, value: (row) => row.area },
  { header: "Pincode", width: 10, value: (row) => row.pincode },
  { header: "Opening balance", width: 16, align: "right", value: (row) => exportAmount(row.openingBalance) },
  { header: "Approved", width: 10, value: (row) => exportYesNo(row.isApproved) },
];

export function SuppliersPage() {
  const canAdd = usePermission("supplier", "add");
  const screen = useMasterScreen<SupplierRow>({ defaultSortBy: "name" });
  const query = useSupplierList(screen.listParams);
  const remove = useDeleteSupplier();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<SupplierRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Supplier",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.name}</div>
            <div className="break-token text-xs text-slate-500">
              {row.original.email ?? "No email recorded"}
            </div>
          </div>
        ),
      },
      {
        id: "mobile",
        header: "Mobile",
        cell: ({ row }) =>
          row.original.mobile ? (
            <span className="tabular text-slate-600">{row.original.mobile}</span>
          ) : (
            <Absent />
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
        id: "openingBalance",
        header: "Opening balance",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.openingBalance ? (
            // Right-aligned and tabular, so a column of amounts can be compared
            // by eye. Formatted from the STRING — never parsed to a number.
            <span className="tabular block text-right text-slate-700">
              {formatMoney(row.original.openingBalance)}
            </span>
          ) : (
            <span className="block text-right">
              <Absent />
            </span>
          ),
      },
      {
        id: "isApproved",
        header: "Approved",
        cell: ({ row }) => (
          <Badge
            dot
            tone={row.original.isApproved ? "success" : "warning"}
            title="Recorded on the supplier. It does not prevent use on a purchase order."
          >
            {row.original.isApproved ? "Approved" : "Not approved"}
          </Badge>
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
        title="Suppliers"
        description="Vendors you raise purchase orders against"
      />

      <DataGrid<SupplierRow>
        // One row above the grid (client request, 18 Sep 2026): the screen's
        // filters beside the search box and its actions at the right-hand end.
        actions={
          <>
            <ExportExcelButton<SupplierRow>
              resource="suppliers"
              params={screen.listParams}
              columns={EXPORT_COLUMNS}
              sheetName="Suppliers"
              fileName="Suppliers"
            />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                Add supplier
              </Button>
            )}
          </>
        }
        gridKey="suppliers"
        columns={columns}
        searchPlaceholder="Search name, GST, mobile or email"
        sortableFields={SUPPLIER_SORT_FIELDS}
        emptyMessage="No suppliers match this search"
        {...screen.gridProps(query)}
      />

      <SupplierFormDialog
        open={screen.isFormOpen}
        supplierId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete supplier"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            {/*
              Stated plainly because it is a real gap rather than a design: the
              check that would refuse this for a supplier with purchase orders
              cannot be written until those tables are migrated, and a count
              against an empty table would pass every time while looking like a
              guard. See the note on SuppliersRepository.remove.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The supplier is marked deleted and hidden from every list. Purchase
              orders and invoices have not been migrated yet, so this cannot check
              whether any reference it.
            </p>
          </>
        }
      />
    </>
  );
}
