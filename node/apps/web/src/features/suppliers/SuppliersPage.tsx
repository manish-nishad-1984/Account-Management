import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SUPPLIER_SORT_FIELDS, type SupplierRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSupplier, useSupplierList } from "./api";
import { SupplierFormDialog } from "./SupplierFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatMoney } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

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
            <div className="text-xs text-slate-500">
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
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add supplier
            </Button>
          ) : undefined
        }
      />

      <DataGrid<SupplierRow>
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
