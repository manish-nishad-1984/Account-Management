import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  INVOICE_TYPES,
  PURCHASE_INVOICE_SORT_FIELDS,
  type PurchaseInvoiceRow,
} from "@accountmanagement/contracts";
import { Check, Plus, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions } from "../purchase-orders/api";
import { useDeletePurchaseInvoice, usePurchaseInvoiceList, useSetApproval } from "./api";
import { PurchaseInvoiceFormDialog } from "./PurchaseInvoiceFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatMoney } from "../../lib/format";

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All invoices" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

/**
 * NO ACTIVE/INACTIVE FILTER, unlike purchase orders.
 *
 * `SupplierInvoice` has no `IsActive` and no `IsDeleted` column, and the legacy
 * list offers no such dropdown — its filters are Search, Company and Supplier.
 * Adding one would mean filtering on a column that never meant anything.
 */
const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  ...INVOICE_TYPES.map((value) => ({ value, label: value })),
];

/** A return or a credit note is money going the other way. Say so on the row. */
const isReturn = (type: string) => type === "Purchase Return" || type === "Credit Note";

export function PurchaseInvoicesPage() {
  const canAdd = usePermission("purchase-invoice", "add");
  const screen = useMasterScreen<PurchaseInvoiceRow>({
    // `documentDate` is nullable and therefore cannot be a keyset sort column —
    // see the contract. `createdAt` is NOT NULL and is the closest honest proxy
    // for "newest first".
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
  });

  const [approval, setApproval] = useState<ApprovalFilter>("all");
  const [invoiceType, setInvoiceType] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  const scope = useSiteScope();
  const companies = useCompanyOptions();
  const query = usePurchaseInvoiceList(screen.listParams, {
    isApproved: approval === "all" ? undefined : approval === "approved",
    invoiceType: invoiceType === "" ? undefined : invoiceType,
    companyId: companyId === "" ? undefined : companyId,
  });
  const remove = useDeletePurchaseInvoice();
  const setApprovalMutation = useSetApproval();

  const { openEdit, askDelete } = screen;

  const companyOptions = useMemo(
    () => [
      { value: "", label: "All companies" },
      ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
    ],
    [companies.data],
  );

  const columns = useMemo<ColumnDef<PurchaseInvoiceRow, unknown>[]>(
    () => [
      {
        id: "supplierInvoiceNo",
        header: "Invoice",
        cell: ({ row }) => (
          <div>
            {/*
              `displayNo`, not `supplierInvoiceNo`. The legacy partial tests
              `SupplierInvoiceNo == ""`, which a NULL fails, so an invoice with no
              supplier number renders an empty link there. Here the fallback is
              computed server-side and this cell is never blank.
            */}
            <div className="tabular font-medium text-slate-900">{row.original.displayNo}</div>
            <div className="text-xs text-slate-500">
              {formatDate(row.original.documentDate) || "No date"}
              {row.original.siteGroupName && ` · ${row.original.siteGroupName}`}
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
        cell: ({ row }) => (
          // Nullable on the source, so it is nullable here and says so rather
          // than rendering an empty cell.
          <span className="text-slate-600">{row.original.siteName ?? "—"}</span>
        ),
      },
      {
        id: "totalAmount",
        header: "Total",
        cell: ({ row }) => (
          <div className="text-right">
            <div className="tabular font-medium text-slate-900">
              {formatMoney(row.original.totalAmount)}
            </div>
            <div className="tabular text-xs text-slate-500">
              {formatMoney(row.original.totalGstAmount)} GST
              {/*
                TDS is shown on the row because it is the term the live screen
                drops. An invoice whose total does not deduct a TDS it records is
                exactly the document B-2 asks about, and it is visible here.
              */}
              {row.original.tds !== "0.00" && ` · less ${formatMoney(row.original.tds)} TDS`}
            </div>
          </div>
        ),
      },
      {
        id: "invoiceType",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <Badge dot tone={row.original.isApproved ? "success" : "warning"}>
              {row.original.isApproved ? "Approved" : "Awaiting approval"}
            </Badge>
            {isReturn(row.original.invoiceType) && (
              <Badge tone="neutral">{row.original.invoiceType}</Badge>
            )}
            {row.original.paymentStatus && (
              <span className="text-xs text-slate-500">{row.original.paymentStatus}</span>
            )}
          </div>
        ),
      },
      {
        id: "subtotal",
        header: "Subtotal",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.subtotal ? (
            <span className="tabular block text-right text-slate-700">
              {formatMoney(row.original.subtotal)}
            </span>
          ) : (
            <span className="block text-right text-slate-300">—</span>
          ),
      },
      {
        id: "totalDiscount",
        header: "Total discount",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.totalDiscount ? (
            <span className="tabular block text-right text-slate-700">
              {formatMoney(row.original.totalDiscount)}
            </span>
          ) : (
            <span className="block text-right text-slate-300">—</span>
          ),
      },
      {
        id: "roundOff",
        header: "Round off",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.roundOff ? (
            <span className="tabular block text-right text-slate-700">
              {formatMoney(row.original.roundOff)}
            </span>
          ) : (
            <span className="block text-right text-slate-300">—</span>
          ),
      },
      {
        id: "lineCount",
        header: "Lines",
        meta: { defaultHidden: true },
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-600">
            {row.original.lineCount}
          </span>
        ),
      },
      {
        id: "isPaidOut",
        header: "Paid out",
        meta: { defaultHidden: true },
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {row.original.isPaidOut ? "Paid out" : "Not paid out"}
          </span>
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
                    ? `Withdraw approval of ${row.original.displayNo}`
                    : `Approve ${row.original.displayNo}`
                }
                disabled={setApprovalMutation.isPending}
                onClick={() =>
                  setApprovalMutation.mutate({
                    id: row.original.id,
                    isApproved: !row.original.isApproved,
                  })
                }
              />
            )}
            <RowActions
              capabilities={row.original.capabilities}
              label={row.original.displayNo}
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
        title="Purchase Invoices"
        description="What a supplier has billed, and what is owed on it"
        actions={
          canAdd && (
            <Button icon={Plus} onClick={screen.openCreate}>
              New invoice
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
            label="Type"
            value={invoiceType}
            options={TYPE_OPTIONS}
            onChange={(event) => setInvoiceType(event.target.value)}
          />
        </div>
        {/*
          The legacy list is filtered by COMPANY rather than by the usual
          All/Most Recent pair — people work one company at a time, the same
          instinct as the global site selector.
        */}
        <div className="max-w-xs flex-1">
          <SelectField
            label="Company"
            value={companyId}
            options={companyOptions}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </div>
      </div>

      <DataGrid<PurchaseInvoiceRow>
        gridKey="purchase-invoices"
        columns={columns}
        searchPlaceholder="Search invoice number, challan number or supplier"
        sortableFields={PURCHASE_INVOICE_SORT_FIELDS}
        emptyMessage={
          scope.siteName
            ? `No purchase invoices for ${scope.siteName} match these filters`
            : "No purchase invoices match these filters"
        }
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
      />

      <PurchaseInvoiceFormDialog
        open={screen.isFormOpen}
        invoiceId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete purchase invoice"
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.displayNo}</span>?
            </p>
            {/*
              A REAL delete, and the wording says so — unlike the purchase order
              dialog, which can honestly promise the record is kept. There is no
              soft-delete column on `SupplierInvoice` to set.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The invoice and its lines are removed permanently. This cannot be undone.
            </p>
          </>
        }
      />
    </>
  );
}
