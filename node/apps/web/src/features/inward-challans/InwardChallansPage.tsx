import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  INWARD_CHALLAN_SORT_FIELDS,
  type InwardChallanRow,
} from "@accountmanagement/contracts";
import { Check, Paperclip, Plus, RotateCcw, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField, TextField } from "../../components/ui";
import {
  useDeleteInwardChallan,
  useInwardChallanList,
  useSetChallanApproval,
  useSupplierOptions,
} from "./api";
import { useItemOptions } from "../purchase-requests/api";
import { InwardChallanFormDialog } from "./InwardChallanFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { formatDate, formatQuantity } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All challans" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

/** Everything the Reset button clears. */
const NO_FILTERS = {
  supplierId: "",
  itemId: "",
  fromDate: "",
  toDate: "",
  approval: "all" as ApprovalFilter,
};

export function InwardChallansPage() {
  const canAdd = usePermission("inward-challan", "add");
  const screen = useMasterScreen<InwardChallanRow>({
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
  });

  /**
   * Filters are APPLIED, not typed-and-applied-as-you-go — the legacy screen is
   * the only one in the system with an explicit Search button and a Reset, and
   * that is right here: choosing a supplier, an item and a date range is three
   * decisions, and re-querying after each is three wasted round trips.
   */
  const [draft, setDraft] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);

  const scope = useSiteScope();
  const suppliers = useSupplierOptions();
  const items = useItemOptions("");

  const query = useInwardChallanList(screen.listParams, {
    supplierId: applied.supplierId || undefined,
    itemId: applied.itemId || undefined,
    fromDate: applied.fromDate || undefined,
    toDate: applied.toDate || undefined,
    isApproved: applied.approval === "all" ? undefined : applied.approval === "approved",
  });

  const remove = useDeleteInwardChallan();
  const setApprovalMutation = useSetChallanApproval();
  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<InwardChallanRow, unknown>[]>(
    () => [
      {
        id: "itemName",
        header: "Item",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.itemName}</div>
            {row.original.receiverName && (
              // Free text: "SURESHBHAI-CC-2000X2 7TH" is a person, a code and a
              // batch reference in one field. Shown whole, never parsed.
              <div className="text-xs text-slate-500">{row.original.receiverName}</div>
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
        id: "supplierName",
        header: "Supplier",
        cell: ({ row }) =>
          row.original.supplierName ? (
            <span className="text-slate-600">{row.original.supplierName}</span>
          ) : (
            <span
              className="text-xs text-slate-400"
              title="The old create screen did not save the supplier"
            >
              Not recorded
            </span>
          ),
      },
      {
        id: "invoiceNo",
        header: "Invoice",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            {/* Free text — 922, 1 and 253-1 are all real. Not right-aligned,
                because it is not a number. */}
            <span className="text-slate-600">{row.original.invoiceNo || <Absent />}</span>
            {row.original.documentCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-xs text-slate-400"
                title={`${row.original.documentCount} attachment${row.original.documentCount === 1 ? "" : "s"}`}
              >
                <Paperclip aria-hidden className="size-3" />
                {row.original.documentCount}
              </span>
            )}
          </div>
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
        id: "siteName",
        header: "Site",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.siteName ? (
            <span className="text-slate-600">{row.original.siteName}</span>
          ) : (
            <span className="text-slate-300">—</span>
          ),
      },
      {
        id: "vehicleNumber",
        header: "Vehicle number",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.vehicleNumber ? (
            <span className="text-slate-600">{row.original.vehicleNumber}</span>
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
                    ? `Withdraw approval of ${row.original.itemName}`
                    : `Approve ${row.original.itemName}`
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

  const supplierOptions = (suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name }));
  const itemOptions = (items.data?.rows ?? []).map((i) => ({ value: i.id, label: i.name }));

  const apply = () => {
    setApplied(draft);
    // A new result set means page one. A cursor carried across a filter change
    // seeks into a sequence that no longer exists, and keyset paging gives no
    // error for that — just a page of rows from nowhere in particular.
    screen.resetPaging();
  };

  return (
    <>
      <PageHeader
        title="Inward Challans"
        description="Goods arriving from a supplier, against their invoice"
        actions={
          canAdd && (
            <Button icon={Plus} onClick={screen.openCreate}>
              New challan
            </Button>
          )
        }
      />

      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <SelectField
          label="Supplier"
          value={draft.supplierId}
          placeholder={suppliers.isLoading ? "Loading…" : "Any supplier"}
          options={supplierOptions}
          onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
        />
        <SelectField
          label="Item"
          value={draft.itemId}
          placeholder={items.isLoading ? "Loading…" : "Any item"}
          options={itemOptions}
          onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}
        />
        <TextField
          label="From"
          type="date"
          value={draft.fromDate}
          onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={draft.toDate}
          onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
        />
        <SelectField
          label="Status"
          value={draft.approval}
          options={APPROVAL_OPTIONS}
          onChange={(e) => setDraft({ ...draft, approval: e.target.value as ApprovalFilter })}
        />

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit">Search</Button>
          <Button
            type="button"
            variant="secondary"
            icon={RotateCcw}
            onClick={() => {
              setDraft(NO_FILTERS);
              setApplied(NO_FILTERS);
              screen.resetPaging();
            }}
          >
            Reset
          </Button>
        </div>
      </form>

      <DataGrid<InwardChallanRow>
        gridKey="inward-challans"
        columns={columns}
        searchPlaceholder="Search item, supplier, invoice or vehicle"
        sortableFields={INWARD_CHALLAN_SORT_FIELDS}
        emptyMessage="No inward challans match these filters"
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
        /*
         * The legacy grid's purple footer row. Over the whole FILTERED SET, not
         * the page — and present even when the set is empty, where the source
         * loses it entirely because it rides on `list[0]`.
         */
        footer={{
          itemName: "Total",
          quantity: (
            <span className="tabular block text-right">
              {formatQuantity(query.data?.totalQuantity ?? "0")}
            </span>
          ),
        }}
      />

      <InwardChallanFormDialog
        open={screen.isFormOpen}
        challanId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete inward challan"
        body={
          <>
            <p>
              Delete the challan for{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.itemName}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The challan is marked deleted and hidden from every list, and its quantity
              leaves the total.
            </p>
          </>
        }
      />
    </>
  );
}
