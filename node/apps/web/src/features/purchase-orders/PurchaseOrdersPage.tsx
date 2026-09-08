import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PURCHASE_ORDER_SORT_FIELDS, type PurchaseOrderRow } from "@accountmanagement/contracts";
import { Check, Plus, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useDeletePurchaseOrder, usePurchaseOrderList, useSetApproval } from "./api";
import { PurchaseOrderFormDialog } from "./PurchaseOrderFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatMoney } from "../../lib/format";

type ApprovalFilter = "all" | "pending" | "approved";
type ActiveFilter = "active" | "inactive" | "all";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All orders" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

/**
 * The legacy list's status dropdown defaults to **Active**, not All
 * (`07-purchase-orders.md`). That default is reproduced, and it is visible on
 * screen rather than hidden in the query — a list that silently omits rows is
 * the thing convention 2 exists to prevent.
 */
const ACTIVE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "Active and inactive" },
];

export function PurchaseOrdersPage() {
  const canAdd = usePermission("purchase-orders", "add");
  const screen = useMasterScreen<PurchaseOrderRow>({
    defaultSortBy: "poNo",
    defaultSortDir: "desc",
  });

  const [approval, setApproval] = useState<ApprovalFilter>("all");
  const [active, setActive] = useState<ActiveFilter>("active");

  const scope = useSiteScope();
  const query = usePurchaseOrderList(screen.listParams, {
    isApproved: approval === "all" ? undefined : approval === "approved",
    isActive: active === "all" ? undefined : active === "active",
  });
  const remove = useDeletePurchaseOrder();
  const setApprovalMutation = useSetApproval();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(
    () => [
      {
        id: "poNo",
        header: "Order",
        cell: ({ row }) => (
          <div>
            <div className="tabular font-medium text-slate-900">{row.original.poNo}</div>
            <div className="text-xs text-slate-500">
              {formatDate(row.original.documentDate) || "No date"}
              {/*
                The legacy list renders `@item.Poid - @item.BuyersPurchaseNo` in
                one cell, which is where the "free-text suffix on the number"
                reading came from. They are two fields and they stay two.
              */}
              {row.original.buyersPurchaseNo && ` · Buyer's ref ${row.original.buyersPurchaseNo}`}
            </div>
          </div>
        ),
      },
      {
        id: "supplierName",
        header: "Supplier",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.supplierName}</div>
            <div className="text-xs text-slate-500">{row.original.companyName}</div>
          </div>
        ),
      },
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) => <span className="text-slate-600">{row.original.siteName}</span>,
      },
      {
        id: "lineCount",
        header: "Lines",
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-600">{row.original.lineCount}</span>
        ),
      },
      {
        id: "totalAmount",
        header: "Total",
        cell: ({ row }) => (
          <div className="text-right">
            {/*
              Indian digit grouping. The legacy screen renders this Western —
              ₹4,663,080.34 where this shows ₹46,63,080.34 — a deliberate port
              improvement flagged in `00-shell-and-navigation.md`, and one of the
              few places the two systems visibly disagree on the same number.
            */}
            <div className="tabular font-medium text-slate-900">
              {formatMoney(row.original.totalAmount)}
            </div>
            <div className="tabular text-xs text-slate-500">
              incl. {formatMoney(row.original.totalGstAmount)} GST
            </div>
          </div>
        ),
      },
      {
        id: "isApproved",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <Badge dot tone={row.original.isApproved ? "success" : "warning"}>
              {row.original.isApproved ? "Approved" : "Awaiting approval"}
            </Badge>
            {!row.original.isActive && <Badge tone="neutral">Inactive</Badge>}
          </div>
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
                    ? `Withdraw approval of ${row.original.poNo}`
                    : `Approve ${row.original.poNo}`
                }
                disabled={setApprovalMutation.isPending}
                onClick={() =>
                  setApprovalMutation.mutate({
                    id: row.original.id,
                    isApproved: !row.original.isApproved,
                  })
                }
              >
                {row.original.isApproved ? "Unapprove" : "Approve"}
              </Button>
            )}
            <RowActions
              capabilities={row.original.capabilities}
              label={row.original.poNo}
              onEdit={() => openEdit(row.original.id)}
              onDelete={() => askDelete(row.original)}
            />
          </div>
        ),
      },
    ],
    [openEdit, askDelete, setApprovalMutation],
  );

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="What has been ordered from a supplier, and for how much"
        actions={
          canAdd && (
            <Button icon={Plus} onClick={screen.openCreate}>
              New order
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="max-w-xs flex-1">
          <SelectField
            label="Approval"
            value={approval}
            options={APPROVAL_OPTIONS}
            onChange={(event) => setApproval(event.target.value as ApprovalFilter)}
          />
        </div>
        <div className="max-w-xs flex-1">
          <SelectField
            label="Status"
            value={active}
            options={ACTIVE_OPTIONS}
            onChange={(event) => setActive(event.target.value as ActiveFilter)}
          />
        </div>
      </div>

      <DataGrid<PurchaseOrderRow>
        columns={columns}
        searchPlaceholder="Search order number, buyer's reference or supplier"
        sortableFields={PURCHASE_ORDER_SORT_FIELDS}
        emptyMessage={
          scope.siteName
            ? `No purchase orders for ${scope.siteName} match these filters`
            : "No purchase orders match these filters"
        }
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
      />

      <PurchaseOrderFormDialog
        open={screen.isFormOpen}
        orderId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete purchase order"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.poNo}</span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The order is marked deleted and hidden from every list. Its lines are kept, and its
              number is not reissued.
            </p>
          </>
        }
      />
    </>
  );
}
