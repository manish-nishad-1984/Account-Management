import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  INVENTORY_INWARD_SORT_FIELDS,
  type InventoryInwardRow,
} from "@accountmanagement/contracts";
import { Check, Info, Plus, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Alert, Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import {
  useDeleteInventoryInward,
  useInventoryInwardList,
  useSetInventoryApproval,
} from "./api";
import { InventoryFormDialog } from "./InventoryFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { formatDate, formatQuantity } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All arrivals" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

export function InventoryPage() {
  const canAdd = usePermission("inventory-inward", "add");
  const screen = useMasterScreen<InventoryInwardRow>({
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
  });

  const [approval, setApproval] = useState<ApprovalFilter>("all");

  const scope = useSiteScope();
  const query = useInventoryInwardList(screen.listParams, {
    isApproved: approval === "all" ? undefined : approval === "approved",
  });
  const remove = useDeleteInventoryInward();
  const setApprovalMutation = useSetInventoryApproval();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<InventoryInwardRow, unknown>[]>(
    () => [
      {
        id: "itemName",
        header: "Item",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.itemName}</div>
            {row.original.details && (
              <div className="text-xs text-slate-500">{row.original.details}</div>
            )}
          </div>
        ),
      },
      {
        id: "documentDate",
        header: "Date",
        cell: ({ row }) => (
          <span className="tabular text-slate-600">
            {formatDate(row.original.documentDate) || <Absent />}
          </span>
        ),
      },
      {
        id: "quantity",
        header: "Quantity",
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-800">
            {formatQuantity(row.original.quantity)}{" "}
            <span className="text-xs text-slate-500">{row.original.unitName}</span>
          </span>
        ),
      },
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) =>
          row.original.siteName ? (
            <span className="text-slate-600">{row.original.siteName}</span>
          ) : (
            // Not an error and not missing data — the old form had no site field
            // at all, so nothing could have filled this in.
            <span className="text-xs text-slate-400" title="The old form had no site field">
              No site recorded
            </span>
          ),
      },
      {
        id: "isApproved",
        header: "Status",
        cell: ({ row }) => (
          <Badge dot tone={row.original.isApproved ? "success" : "warning"}>
            {row.original.isApproved ? "Approved" : "Awaiting approval"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {row.original.capabilities.canApprove && (
              <Button
                variant="ghost"
                icon={row.original.isApproved ? Undo2 : Check}
                title={
                  row.original.isApproved
                    ? `Withdraw approval of ${row.original.itemName}`
                    : `Approve ${row.original.itemName}`
                }
                disabled={setApprovalMutation.isPending}
                onClick={() =>
                  setApprovalMutation.mutate({
                    id: row.original.id,
                    // Stated, not toggled from what is on screen.
                    isApproved: !row.original.isApproved,
                  })
                }
              >
                {row.original.isApproved ? "Unapprove" : "Approve"}
              </Button>
            )}
            <RowActions
              capabilities={row.original.capabilities}
              label={row.original.itemName}
              onEdit={() => openEdit(row.original.id)}
              onDelete={() => askDelete(row.original)}
            />
          </div>
        ),
      },
    ],
    [openEdit, askDelete, setApprovalMutation],
  );

  const unallocated = query.data?.unallocated ?? 0;

  return (
    <>
      <PageHeader
        title="Inventory Inward"
        description="Stock arriving at a site"
        actions={
          canAdd && (
            <Button icon={Plus} onClick={screen.openCreate}>
              New arrival
            </Button>
          )
        }
      />

      {/*
        Says WHY a site-scoped list is showing rows that belong to no site.
        Without it the site filter looks broken. Shown only while such rows
        exist, and only while a site is actually chosen.
      */}
      {unallocated > 0 && scope.siteId !== null && (
        <Alert tone="info" icon={Info} className="mb-4">
          {unallocated} arrival{unallocated === 1 ? "" : "s"} recorded before this system
          have no site against them — the old screen had no site field — so they are shown
          under every site. New arrivals are recorded against{" "}
          <span className="font-medium">{scope.siteName ?? "the chosen site"}</span>.
        </Alert>
      )}

      <div className="mb-4 max-w-xs">
        <SelectField
          label="Status"
          value={approval}
          options={APPROVAL_OPTIONS}
          onChange={(event) => setApproval(event.target.value as ApprovalFilter)}
        />
      </div>

      <DataGrid<InventoryInwardRow>
        columns={columns}
        searchPlaceholder="Search item, unit or details"
        sortableFields={INVENTORY_INWARD_SORT_FIELDS}
        emptyMessage="No inventory arrivals match these filters"
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
      />

      <InventoryFormDialog
        open={screen.isFormOpen}
        recordId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete inventory arrival"
        body={
          <>
            <p>
              Delete the arrival of{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget?.itemName}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The row is marked deleted and hidden from every list. The old system
              removed the row outright; this one keeps it.
            </p>
          </>
        }
      />
    </>
  );
}
