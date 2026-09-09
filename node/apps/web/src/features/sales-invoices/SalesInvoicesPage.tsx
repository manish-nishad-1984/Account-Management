import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  SALES_INVOICE_SORT_FIELDS,
  SALES_INVOICE_TYPES,
  type SalesInvoiceRow,
} from "@accountmanagement/contracts";
import { Check, Plus, Undo2 } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import {
  useCompanyOptions,
  useDeleteSalesInvoice,
  useSalesInvoiceList,
  useSetApproval,
} from "./api";
import { SalesInvoiceFormDialog } from "./SalesInvoiceFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatMoney } from "../../lib/format";

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All invoices" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  ...SALES_INVOICE_TYPES.map((value) => ({ value, label: value })),
];

const isReturn = (type: string) => type === "Sales Return" || type === "Credit Note";

export function SalesInvoicesPage() {
  const canAdd = usePermission("sales-invoice", "add");
  const screen = useMasterScreen<SalesInvoiceRow>({
    defaultSortBy: "salesInvoiceNo",
    defaultSortDir: "desc",
  });

  const [approval, setApproval] = useState<ApprovalFilter>("all");
  const [invoiceType, setInvoiceType] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  const scope = useSiteScope();
  const companies = useCompanyOptions();
  const query = useSalesInvoiceList(screen.listParams, {
    isApproved: approval === "all" ? undefined : approval === "approved",
    invoiceType: invoiceType === "" ? undefined : invoiceType,
    companyId: companyId === "" ? undefined : companyId,
  });
  const remove = useDeleteSalesInvoice();
  const setApprovalMutation = useSetApproval();

  const { openEdit, askDelete } = screen;

  const companyOptions = useMemo(
    () => [
      { value: "", label: "All companies" },
      ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
    ],
    [companies.data],
  );

  const columns = useMemo<ColumnDef<SalesInvoiceRow, unknown>[]>(
    () => [
      {
        id: "salesInvoiceNo",
        header: "Invoice",
        cell: ({ row }) => (
          <div>
            {/*
              OURS, and NOT NULL — no `displayNo` fallback is needed here, unlike
              the purchase side, because a sales invoice cannot exist without the
              number the server gave it.
            */}
            <div className="tabular font-medium text-slate-900">{row.original.salesInvoiceNo}</div>
            <div className="text-xs text-slate-500">
              {formatDate(row.original.documentDate) || "No date"}
              {row.original.customerInvoiceNo && ` · Their ref ${row.original.customerInvoiceNo}`}
            </div>
          </div>
        ),
      },
      {
        // The legacy list calls this column Customer while labelling its own
        // filter Supplier. One party table, both sides of the trade — the column
        // is named for what it means.
        id: "customerName",
        header: "Customer",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.customerName}</div>
            <div className="text-xs text-slate-500">{row.original.companyName}</div>
          </div>
        ),
      },
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) => <span className="text-slate-600">{row.original.siteName ?? "—"}</span>,
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
                    ? `Withdraw approval of ${row.original.salesInvoiceNo}`
                    : `Approve ${row.original.salesInvoiceNo}`
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
              label={row.original.salesInvoiceNo}
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
        title="Sales Invoices"
        description="What has been billed to a customer, and what is due"
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
        <div className="max-w-xs flex-1">
          <SelectField
            label="Company"
            value={companyId}
            options={companyOptions}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </div>
      </div>

      <DataGrid<SalesInvoiceRow>
        columns={columns}
        searchPlaceholder="Search invoice number, challan number or customer"
        sortableFields={SALES_INVOICE_SORT_FIELDS}
        emptyMessage={
          scope.siteName
            ? `No sales invoices for ${scope.siteName} match these filters`
            : "No sales invoices match these filters"
        }
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
      />

      <SalesInvoiceFormDialog
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
        title="Delete sales invoice"
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget?.salesInvoiceNo}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The invoice and its lines are removed permanently. This cannot be undone, and the
              number is not reissued.
            </p>
          </>
        }
      />
    </>
  );
}
