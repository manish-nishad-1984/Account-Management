import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  PURCHASE_REQUEST_SORT_FIELDS,
  type PurchaseRequestRow,
} from "@accountmanagement/contracts";
import { Check, Plus, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useDeletePurchaseRequest, usePurchaseRequestList, useSetApproval } from "./api";
import { PurchaseRequestFormDialog } from "./PurchaseRequestFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatQuantity } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All requests" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

export function PurchaseRequestsPage() {
  const canAdd = usePermission("purchase-request", "add");
  const screen = useMasterScreen<PurchaseRequestRow>({ defaultSortBy: "prNo", defaultSortDir: "desc" });

  const [approval, setApproval] = useState<ApprovalFilter>("all");

  // The site is chosen once, in the shell header, and applies to every scoped
  // screen. This one reads the choice only to say so in its empty state.
  const scope = useSiteScope();
  const query = usePurchaseRequestList(screen.listParams, {
    isApproved: approval === "all" ? undefined : approval === "approved",
  });
  const remove = useDeletePurchaseRequest();
  const setApprovalMutation = useSetApproval();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<PurchaseRequestRow, unknown>[]>(
    () => [
      {
        id: "prNo",
        header: "Request",
        cell: ({ row }) => (
          <div>
            <div className="tabular font-medium text-slate-900">{row.original.prNo}</div>
            <div className="text-xs text-slate-500">
              {formatDate(row.original.documentDate) || "No date"}
            </div>
          </div>
        ),
      },
      {
        id: "itemLabel",
        header: "Item",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">
              {row.original.itemLabel || <Absent />}
            </div>
            {row.original.itemId === null && (
              <div className="text-xs text-slate-500">Not in the item catalogue</div>
            )}
            {row.original.itemDescription && (
              <div className="text-xs text-slate-500">{row.original.itemDescription}</div>
            )}
          </div>
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
        cell: ({ row }) => <span className="text-slate-600">{row.original.siteName}</span>,
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
        id: "siteAddress",
        header: "Site address",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.siteAddress ? (
            <span className="text-slate-600">{row.original.siteAddress}</span>
          ) : (
            <span className="text-slate-300">—</span>
          ),
      },
      {
        id: "createdAt",
        header: "Created",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.createdAt ? (
            <span className="tabular text-slate-600">{formatDate(row.original.createdAt)}</span>
          ) : (
            <span className="text-slate-300">—</span>
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
                    ? `Withdraw approval of ${row.original.prNo}`
                    : `Approve ${row.original.prNo}`
                }
                disabled={setApprovalMutation.isPending}
                onClick={() =>
                  setApprovalMutation.mutate({
                    id: row.original.id,
                    // The value is STATED, not toggled from what is on screen:
                    // a stale row would otherwise flip approval the wrong way.
                    isApproved: !row.original.isApproved,
                  })
                }
              >
                {row.original.isApproved ? "Unapprove" : "Approve"}
              </Button>
            )}
            <RowActions
              capabilities={row.original.capabilities}
              label={row.original.prNo}
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
        title="Purchase Requests"
        description="What a site has asked for, before it becomes a purchase order"
        actions={
          canAdd && (
            <Button icon={Plus} onClick={screen.openCreate}>
              New request
            </Button>
          )
        }
      />

      <div className="mb-4 max-w-xs">
        <SelectField
          label="Status"
          value={approval}
          options={APPROVAL_OPTIONS}
          onChange={(event) => setApproval(event.target.value as ApprovalFilter)}
        />
      </div>

      <DataGrid<PurchaseRequestRow>
        gridKey="purchase-requests"
        columns={columns}
        searchPlaceholder="Search request number or item"
        sortableFields={PURCHASE_REQUEST_SORT_FIELDS}
        emptyMessage={
          scope.siteName
            ? `No purchase requests for ${scope.siteName} match these filters`
            : "No purchase requests match these filters"
        }
        {...screen.gridProps(query)}
        // The list does not fetch until the site scope resolves. Without this the
        // grid renders its empty state in the gap and reports "no requests" for a
        // site it has not asked about yet.
        isLoading={query.isLoading || !scope.isReady}
      />

      <PurchaseRequestFormDialog
        open={screen.isFormOpen}
        requestId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete purchase request"
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.prNo}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The request is marked deleted and hidden from every list. Its number
              is not reissued.
            </p>
          </>
        }
      />
    </>
  );
}
