import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PAYMENT_SORT_FIELDS, type PaymentRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import { exportAmount, exportDate, type ExportColumn } from "../../lib/grid-export";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatMoney } from "../../lib/format";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { PaymentEditDialog } from "./PaymentEditDialog";
import { useDeletePayment, usePaymentList } from "./api";

/**
 * Panel 3 of `/Report/ReportDetails` — "Payment Actions" — as its own screen.
 *
 * It is a screen rather than a panel because it WRITES, and the two panels above
 * it read. Keeping a create-and-delete grid stacked under two reports is what
 * makes the legacy page 1130 lines of JavaScript; the reports link here instead.
 */

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column — the screen's own columns, as text. */
const EXPORT_COLUMNS: ExportColumn<PaymentRow>[] = [
  { header: "Date", width: 12, value: (row) => exportDate(row.paymentDate) },
  { header: "Type", width: 16, value: (row) => (row.kind === "opening_balance" ? "Opening balance" : "Payment") },
  { header: "Party", width: 30, value: (row) => row.partyName },
  { header: "Company", width: 26, value: (row) => row.companyName },
  { header: "Site", width: 26, value: (row) => row.siteName },
  { header: "Location", width: 24, value: (row) => row.siteLocationName },
  { header: "Method", width: 16, value: (row) => row.method },
  { header: "Reference no.", width: 18, value: (row) => row.referenceNo },
  { header: "Description", width: 36, value: (row) => row.description },
  { header: "Amount", width: 16, align: "right", value: (row) => exportAmount(row.amount) },
  { header: "Created", width: 12, value: (row) => exportDate(row.createdAt) },
];

export function PaymentsPage() {
  const canAdd = usePermission("reports-payments", "add");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [formOpen, setFormOpen] = useState(false);
  // The payment open for editing (the Record payments repeater only creates).
  const [editing, setEditing] = useState<PaymentRow | null>(null);

  const screen = useMasterScreen<PaymentRow>({ defaultSortBy: "createdAt", defaultSortDir: "desc" });
  const filters = { direction };
  const query = usePaymentList(screen.listParams, filters);
  const remove = useDeletePayment();

  const { askDelete } = screen;

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(
    () => [
      {
        id: "paymentDate",
        header: "Date",
        cell: ({ row }) => (
          <div>
            <div className="tabular text-slate-800">
              {row.original.paymentDate ? formatDate(row.original.paymentDate) : <Absent />}
            </div>
            {row.original.kind === "opening_balance" && (
              <Badge tone="info" title="A balance brought forward, not a payment.">
                Opening balance
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "partyName",
        header: "Party",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.partyName}</div>
            <div className="text-xs text-slate-500">{row.original.companyName}</div>
          </div>
        ),
      },
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) =>
          row.original.siteName ?? (
            // Null is the deliberate case for an opening balance, not missing data.
            <span className="text-xs text-slate-400">
              {row.original.kind === "opening_balance" ? "Not site-specific" : "No site"}
            </span>
          ),
      },
      {
        id: "method",
        header: "Method",
        cell: ({ row }) => (
          <div>
            <div className="text-slate-600">{row.original.method ?? <Absent />}</div>
            {row.original.referenceNo && (
              <div className="tabular text-xs text-slate-500">{row.original.referenceNo}</div>
            )}
          </div>
        ),
      },
      {
        id: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-slate-600">{row.original.description ?? <Absent />}</span>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular block text-right font-medium text-slate-900">
            {formatMoney(row.original.amount)}
          </span>
        ),
      },
      {
        id: "siteLocationName",
        header: "Location",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.siteLocationName ? (
            <span className="text-slate-600">{row.original.siteLocationName}</span>
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
          <RowActions
            capabilities={row.original.capabilities}
            label={`payment of ${row.original.amount} to ${row.original.partyName}`}
            onEdit={() => setEditing(row.original)}
            onDelete={() => askDelete(row.original)}
          />
        ),
      },
    ],
    [askDelete, screen],
  );

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money paid to suppliers and received from customers"
      />

      <DataGrid<PaymentRow>
        // One row above the grid (client request, 18 Sep 2026): the screen's
        // filters beside the search box and its actions at the right-hand end.
        actions={<>
            <ExportExcelButton<PaymentRow>
              resource="payments"
              params={screen.listParams}
              filters={filters}
              columns={EXPORT_COLUMNS}
              sheetName={direction === "out" ? "Payments paid out" : "Payments received"}
              fileName={direction === "out" ? "Payments-paid-out" : "Payments-received"}
            />
            {/*
              The legacy screen has one direction per screen — PayOut on the
              report and PayIn on the sales side — with the same repeater built
              twice. One screen, one toggle.
            */}
            <div className="flex rounded-md ring-1 ring-inset ring-slate-300">
              {(["out", "in"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={direction === value}
                  onClick={() => {
                    setDirection(value);
                    screen.resetPaging();
                  }}
                  className={`px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md ${
                    direction === value
                      ? "bg-brand-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {value === "out" ? "Paid out" : "Received"}
                </button>
              ))}
            </div>
            {canAdd && (
              <Button icon={Plus} onClick={() => setFormOpen(true)}>
                Record payments
              </Button>
            )}
          </>}
        gridKey="payments"
        columns={columns}
        searchPlaceholder="Search party, description or reference"
        sortableFields={PAYMENT_SORT_FIELDS}
        emptyMessage={
          direction === "out" ? "No payments to suppliers yet" : "No receipts from customers yet"
        }
        {...screen.gridProps(query)}
      />

      <PaymentFormDialog
        open={formOpen}
        direction={direction}
        onClose={() => setFormOpen(false)}
      />

      <PaymentEditDialog
        row={editing}
        readOnly={editing !== null && !editing.capabilities.canEdit}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete payment"
        body={
          <>
            <p>
              Delete the payment of{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget ? formatMoney(screen.deleteTarget.amount) : ""}
              </span>{" "}
              to {screen.deleteTarget?.partyName}?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              This changes the party&apos;s balance on every report. The payment
              is marked deleted rather than removed, so the change can be traced.
              The old system deleted the row outright.
            </p>
          </>
        }
      />
    </>
  );
}
