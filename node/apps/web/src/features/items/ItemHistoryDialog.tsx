import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import type { ItemPriceHistoryRow } from "@accountmanagement/contracts";
import { Alert, Badge, EmptyState, Modal } from "../../components/ui";
import { formatDate, formatMoney, formatPercent, formatQuantity } from "../../lib/format";
import { describeLoadError } from "../../lib/load-error";
import { useItemPriceHistory } from "./api";

/**
 * The clock icon's panel — what this item has actually cost.
 *
 * The legacy `_ItemHistoryPartial.cshtml` renders
 * `InvoiceNo | Supplier | Site | Date | Price | GST | PriceWithGST` into a fixed
 * 506px scroll box. The same seven columns are here, plus the quantity and the
 * effective price, and each of the four defects in the legacy version is
 * departed from — see `contracts/item-price-history.ts`, which carries the
 * reasoning on the field it affects.
 *
 * It is a plain `<table>` rather than `DataGrid`. The grid brings a search box,
 * sortable headers and a cursor pager, and none of the three has anything to
 * act on here: the endpoint takes no search, no sort and no cursor. A grid
 * offering controls that do nothing is worse than a table that offers none.
 */

const Absent = () => <span className="text-slate-300">—</span>;

/**
 * A purchase return is not a price paid, and the legacy panel shows it as one.
 *
 * The legacy query excludes only `InvoiceNo = "PayOut"`, so returns and credit
 * notes have always been in this list, indistinguishable from purchases. They
 * stay — dropping them would change what the panel contains — but they are
 * marked, because a return priced differently reads as a price that was paid.
 */
const RETURN_TYPES = new Set(["Purchase Return", "Credit Note"]);

function InvoiceCell({ row }: { row: ItemPriceHistoryRow }) {
  return (
    <div>
      <div className="font-medium text-slate-900">{row.displayNo}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {RETURN_TYPES.has(row.invoiceType) && (
          <Badge tone="warning" title="Not a purchase. The amount was returned or credited.">
            {row.invoiceType}
          </Badge>
        )}
        {!row.isApproved && (
          <Badge tone="neutral" title="This invoice has not been approved yet.">
            Not approved
          </Badge>
        )}
      </div>
    </div>
  );
}

export function ItemHistoryDialog({
  open,
  itemId,
  itemName,
  /** The item master's own price, for comparison against what was paid. */
  pricePerUnit,
  onClose,
}: {
  open: boolean;
  itemId: string | null;
  itemName: string;
  pricePerUnit: string | null;
  onClose: () => void;
}) {
  const query = useItemPriceHistory(open ? itemId : null);
  const history = query.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={itemName ? `Price history — ${itemName}` : "Price history"}
      description="What this item has cost on purchase invoices, newest first"
      size="xl"
    >
      {pricePerUnit !== null && (
        <p className="mb-3 text-xs text-slate-500">
          The item master price is{" "}
          <span className="tabular font-medium text-slate-700">{formatMoney(pricePerUnit)}</span>{" "}
          per unit. The prices below are what was invoiced, which is a different
          number and the reason this panel exists.
        </p>
      )}

      {query.isError && (
        <Alert icon={AlertTriangle} className="mb-3">
          {describeLoadError(query.error, "the price history")}
        </Alert>
      )}

      {query.isPending && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading price history
        </div>
      )}

      {history && history.rows.length === 0 && (
        <EmptyState
          icon={Clock}
          title="No invoices found"
          description="This item has not appeared on a purchase invoice yet. Its master price is what it would be ordered at."
        />
      )}

      {history && history.rows.length > 0 && (
        <>
          {/*
            The wide table scrolls inside its own box rather than pushing the
            dialog sideways — nine columns do not fit a narrow window, and a
            modal that scrolls horizontally moves its own close button off screen.
          */}
          <div className="max-h-[26rem] overflow-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Invoice</th>
                  <th className="px-3 py-2 text-left font-medium">Supplier</th>
                  <th className="px-3 py-2 text-left font-medium">Site</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">GST</th>
                  <th className="px-3 py-2 text-right font-medium">Paid / unit</th>
                  <th className="px-3 py-2 text-right font-medium">With GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-3 py-2">
                      <InvoiceCell row={row} />
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.supplierName}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {/*
                        `site_id` is nullable and the source INNER JOINs it, so
                        these rows are invisible in the legacy panel entirely.
                      */}
                      {row.siteName ?? <span className="text-xs text-slate-400">No site</span>}
                    </td>
                    <td className="tabular px-3 py-2 text-slate-600">
                      {row.documentDate ? formatDate(row.documentDate) : <Absent />}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-600">
                      {formatQuantity(row.quantity)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-700">
                      {formatMoney(row.unitPrice)}
                      {row.discountPerUnit !== "0.00" && (
                        <div className="text-xs text-slate-400">
                          less {formatMoney(row.discountPerUnit)}
                        </div>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-600">
                      {/*
                        The LINE's rate, not the item master's. The legacy panel
                        reads `f.Gstper` off the master, so editing the item
                        silently rewrites the rate shown against every past
                        invoice.
                      */}
                      {row.gstPercent ? formatPercent(row.gstPercent) : <Absent />}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium text-slate-900">
                      {formatMoney(row.effectiveUnitPrice)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-700">
                      {formatMoney(row.effectiveUnitPriceWithGst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {history.total > history.rows.length ? (
              <>
                Showing the {history.rows.length} most recent of {history.total} invoice lines.
              </>
            ) : (
              <>
                {history.total} invoice {history.total === 1 ? "line" : "lines"}, across every
                site.
              </>
            )}{" "}
            Prices are per unit. &quot;Paid / unit&quot; is after any discount and before GST.
          </p>
        </>
      )}
    </Modal>
  );
}
