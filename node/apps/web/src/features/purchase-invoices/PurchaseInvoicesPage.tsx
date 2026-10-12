import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  INVOICE_TYPES,
  PURCHASE_INVOICE_SORT_FIELDS,
  type PurchaseInvoiceRow,
} from "@accountmanagement/contracts";
import { Check, Plus, Undo2, Upload } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import {
  exportAmount,
  exportDate,
  type ExportColumn,
} from "../../lib/grid-export";
import {
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  SelectField,
} from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions } from "../purchase-orders/api";
import {
  useDeletePurchaseInvoice,
  usePurchaseInvoiceList,
  useSetApproval,
} from "./api";
import { PurchaseInvoiceFormDialog } from "./PurchaseInvoiceFormDialog";
import { LocationImportDialog } from "./LocationImportDialog";
import { usePermission } from "../../lib/permissions";
import {
  DocumentActions,
  DocumentPdfError,
  useDocumentPdf,
} from "../document-templates/DocumentActions";
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
const isReturn = (type: string) =>
  type === "Purchase Return" || type === "Credit Note";

/** What the sheet holds, column for column — the screen's own columns, as text. */
const EXPORT_COLUMNS: ExportColumn<PurchaseInvoiceRow>[] = [
  { header: "Invoice", width: 20, value: (row) => row.displayNo },
  { header: "Date", width: 12, value: (row) => exportDate(row.documentDate) },
  { header: "Type", width: 16, value: (row) => row.invoiceType },
  { header: "Supplier", width: 32, value: (row) => row.supplierName },
  { header: "Company", width: 28, value: (row) => row.companyName },
  { header: "Site", width: 22, value: (row) => row.siteName },
  { header: "Site location", width: 22, value: (row) => row.siteLocationName },
  { header: "Subtotal", width: 14, align: "right", value: (row) => exportAmount(row.subtotal) },
  { header: "Total discount", width: 14, align: "right", value: (row) => exportAmount(row.totalDiscount) },
  { header: "GST", width: 14, align: "right", value: (row) => exportAmount(row.totalGstAmount) },
  { header: "TDS", width: 12, align: "right", value: (row) => exportAmount(row.tds) },
  { header: "Round off", width: 12, align: "right", value: (row) => exportAmount(row.roundOff) },
  { header: "Total", width: 16, align: "right", value: (row) => exportAmount(row.totalAmount) },
  { header: "Pending amount", width: 16, align: "right", value: (row) => exportAmount(row.pendingAmount) },
  { header: "Created", width: 12, value: (row) => exportDate(row.createdAt) },
];

export function PurchaseInvoicesPage() {
  const canAdd = usePermission("purchase-invoice", "add");
  const canEdit = usePermission("purchase-invoice", "edit");
  const [importOpen, setImportOpen] = useState(false);
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
  const pdf = useDocumentPdf();
  const companies = useCompanyOptions();
  const filterValues = {
    isApproved: approval === "all" ? undefined : approval === "approved",
    invoiceType: invoiceType === "" ? undefined : invoiceType,
    companyId: companyId === "" ? undefined : companyId,
  };
  const query = usePurchaseInvoiceList(screen.listParams, filterValues);
  // The list hook adds the header's site; the export must carry it too.
  const exportFilters = { ...filterValues, siteId: scope.siteId ?? undefined };
  const remove = useDeletePurchaseInvoice();
  const setApprovalMutation = useSetApproval();

  const { openEdit, askDelete } = screen;

  const companyOptions = useMemo(
    () => [
      { value: "", label: "All companies" },
      ...(companies.data?.rows ?? []).map((row) => ({
        value: row.id,
        label: row.name,
      })),
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
            <div className="tabular font-medium text-slate-900">
              {row.original.displayNo}
            </div>
            <div className="text-xs text-slate-500">
              {formatDate(row.original.documentDate) || "No date"}
              {row.original.siteLocationName &&
                ` · ${row.original.siteLocationName}`}
            </div>
          </div>
        ),
      },
      {
        id: "supplierName",
        header: "Supplier",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">
              {row.original.supplierName}
            </div>
            <div className="text-xs text-slate-500">
              {row.original.companyName}
            </div>
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
        meta: { align: "right" },
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
              {row.original.tds !== "0.00" &&
                ` · less ${formatMoney(row.original.tds)} TDS`}
            </div>
          </div>
        ),
      },
      {
        id: "settlement",
        header: "Payment",
        cell: ({ row }) => {
          const { settlement, pendingAmount } = row.original;
          if (!settlement) return <span className="text-slate-300">—</span>;
          if (settlement === "paid") return <Badge dot tone="success">Paid</Badge>;
          return (
            <div className="flex flex-col items-start gap-0.5">
              <Badge dot tone={settlement === "part" ? "warning" : "danger"}>
                {settlement === "part" ? "Part paid" : "Unpaid"}
              </Badge>
              <span className="tabular text-xs text-slate-500">{formatMoney(pendingAmount ?? "0")} to pay</span>
            </div>
          );
        },
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
              <span className="text-xs text-slate-500">
                {row.original.paymentStatus}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "subtotal",
        header: "Subtotal",
        meta: { align: "right", defaultHidden: true },
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
        meta: { align: "right", defaultHidden: true },
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
        meta: { align: "right", defaultHidden: true },
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
        meta: { align: "right", defaultHidden: true },
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
            <span className="tabular text-slate-600">
              {formatDate(row.original.createdAt)}
            </span>
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
            <DocumentActions
              pdf={pdf}
              documentType="purchase-invoice"
              id={row.original.id}
              label={row.original.displayNo}
            />
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
    [openEdit, askDelete, setApprovalMutation, pdf],
  );

  return (
    <>
      <PageHeader
        title="Purchase Invoices"
        description="What a supplier has billed, and what is owed on it"
      />

      <DocumentPdfError pdf={pdf} />

      <DataGrid<PurchaseInvoiceRow>
        // One row above the grid (client request, 18 Sep 2026): the screen's
        // filters beside the search box and its actions at the right-hand end.
        filters={
          <>
            <SelectField
              labelHidden
              label="Approval"
              value={approval}
              options={APPROVAL_OPTIONS}
              onChange={(event) =>
                setApproval(event.target.value as ApprovalFilter)
              }
            />
            <SelectField
              labelHidden
              label="Type"
              value={invoiceType}
              options={TYPE_OPTIONS}
              onChange={(event) => setInvoiceType(event.target.value)}
            />
            {/*
          The legacy list is filtered by COMPANY rather than by the usual
          All/Most Recent pair — people work one company at a time, the same
          instinct as the global site selector.
        */}
            <SelectField
              labelHidden
              label="Company"
              value={companyId}
              options={companyOptions}
              onChange={(event) => setCompanyId(event.target.value)}
            />
          </>
        }
        actions={
          <>
            <ExportExcelButton<PurchaseInvoiceRow>
              resource="purchase-invoices"
              params={screen.listParams}
              filters={exportFilters}
              columns={EXPORT_COLUMNS}
              sheetName="Purchase Invoices"
              fileName="Purchase-Invoices"
            />
            {canEdit && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                Import locations
              </Button>
            )}
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                New invoice
              </Button>
            )}
          </>
        }
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

      <LocationImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

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
        typeToConfirm={screen.deleteTarget?.displayNo ?? ""}
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget?.displayNo}
              </span>
              ?
            </p>
            {/*
              A REAL delete, and the wording says so — unlike the purchase order
              dialog, which can honestly promise the record is kept. There is no
              soft-delete column on `SupplierInvoice` to set.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The invoice and its lines are removed permanently. This cannot be
              undone.
            </p>
          </>
        }
      />
    </>
  );
}
