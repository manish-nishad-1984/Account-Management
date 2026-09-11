import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PAYMENT_SORT_FIELDS, type PaymentRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatDate, formatMoney } from "../../lib/format";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { useDeletePayment, usePaymentList } from "./api";

/**
 * Panel 3 of `/Report/ReportDetails` — "Payment Actions" — as its own screen.
 *
 * It is a screen rather than a panel because it WRITES, and the two panels above
 * it read. Keeping a create-and-delete grid stacked under two reports is what
 * makes the legacy page 1130 lines of JavaScript; the reports link here instead.
 */

const Absent = () => <span className="text-slate-300">—</span>;

export function PaymentsPage() {
  const canAdd = usePermission("reports-payments", "add");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [formOpen, setFormOpen] = useState(false);

  const screen = useMasterScreen<PaymentRow>({ defaultSortBy: "createdAt", defaultSortDir: "desc" });
  const query = usePaymentList(screen.listParams, { direction });
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
        cell: ({ row }) => (
          <span className="tabular block text-right font-medium text-slate-900">
            {formatMoney(row.original.amount)}
          </span>
        ),
      },
      {
        id: "siteGroupName",
        header: "Site group",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.siteGroupName ? (
            <span className="text-slate-600">{row.original.siteGroupName}</span>
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
            onEdit={() => screen.openEdit(row.original.id)}
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
        actions={
          <>
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
          </>
        }
      />

      <DataGrid<PaymentRow>
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
