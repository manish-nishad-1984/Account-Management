import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import {
  PURCHASE_INVOICE_LINES_MAX_IDS,
  purchaseInvoiceLinesResponseSchema,
  type PurchaseInvoiceExportLine,
  type PurchaseInvoiceRow,
} from "@accountmanagement/contracts";
import { Button } from "../../components/ui";
import { apiRequest } from "../../lib/api-client";
import {
  downloadGridExcel,
  exportAmount,
  exportDate,
  fetchAllRows,
  type ExportColumn,
} from "../../lib/grid-export";
import type { ListFilters, ListParams } from "../../lib/list-query";

/** One row of the sheet with items: an invoice line, or an invoice that has none. */
export interface InvoiceLineRow {
  invoice: PurchaseInvoiceRow;
  line: PurchaseInvoiceExportLine | null;
  /** The invoice's first row: its totals are written here only, so a column sums to the right figure. */
  first: boolean;
}

/** The invoice's own columns, written on every line so the sheet can be filtered and sorted. */
const INVOICE_COLUMNS: ExportColumn<InvoiceLineRow>[] = [
  { header: "Invoice", width: 20, value: (row) => row.invoice.displayNo },
  { header: "Our no.", width: 18, value: (row) => row.invoice.invoiceNo },
  { header: "Date", width: 12, value: (row) => exportDate(row.invoice.documentDate) },
  { header: "Type", width: 16, value: (row) => row.invoice.invoiceType },
  { header: "Supplier", width: 32, value: (row) => row.invoice.supplierName },
  { header: "Company", width: 28, value: (row) => row.invoice.companyName },
  { header: "Site", width: 22, value: (row) => row.invoice.siteName },
  { header: "Site location", width: 22, value: (row) => row.invoice.siteLocationName },
];

/** Figures that belong to the whole invoice: on its first row only. */
const once =
  (pick: (invoice: PurchaseInvoiceRow) => string | null) =>
  (row: InvoiceLineRow): string =>
    row.first ? exportAmount(pick(row.invoice)) : "";

export const WITH_ITEMS_COLUMNS: ExportColumn<InvoiceLineRow>[] = [
  ...INVOICE_COLUMNS,
  { header: "Line", width: 6, align: "right", value: (row) => row.line?.lineNumber },
  { header: "Item", width: 32, value: (row) => row.line?.itemLabel },
  { header: "Description", width: 28, value: (row) => row.line?.itemDescription },
  { header: "Unit", width: 10, value: (row) => row.line?.unitName },
  { header: "Quantity", width: 12, align: "right", value: (row) => exportAmount(row.line?.quantity) },
  { header: "Rate", width: 14, align: "right", value: (row) => exportAmount(row.line?.unitPrice) },
  { header: "Discount per unit", width: 14, align: "right", value: (row) => exportAmount(row.line?.discountPerUnit) },
  { header: "Discount %", width: 10, align: "right", value: (row) => exportAmount(row.line?.discountPercent) },
  { header: "GST %", width: 8, align: "right", value: (row) => exportAmount(row.line?.gstPercent) },
  { header: "GST amount", width: 14, align: "right", value: (row) => exportAmount(row.line?.gstAmount) },
  { header: "Net amount", width: 14, align: "right", value: (row) => exportAmount(row.line?.netAmount) },
  { header: "Line total", width: 16, align: "right", value: (row) => exportAmount(row.line?.lineTotal) },
  { header: "Invoice TDS", width: 12, align: "right", value: once((invoice) => invoice.tds) },
  { header: "Invoice round off", width: 12, align: "right", value: once((invoice) => invoice.roundOff) },
  { header: "Invoice total", width: 16, align: "right", value: once((invoice) => invoice.totalAmount) },
  { header: "Pending amount", width: 16, align: "right", value: once((invoice) => invoice.pendingAmount) },
];

/** Each invoice followed by its lines, in the list's order; an invoice with no line is one row. */
export function toLineRows(invoices: PurchaseInvoiceRow[], lines: PurchaseInvoiceExportLine[]): InvoiceLineRow[] {
  const byInvoice = new Map<string, PurchaseInvoiceExportLine[]>();
  for (const line of lines) byInvoice.set(line.purchaseInvoiceId, [...(byInvoice.get(line.purchaseInvoiceId) ?? []), line]);
  return invoices.flatMap((invoice): InvoiceLineRow[] => {
    const own = (byInvoice.get(invoice.id) ?? []).sort((a, b) => a.lineNumber - b.lineNumber);
    if (own.length === 0) return [{ invoice, line: null, first: true }];
    return own.map((line, index) => ({ invoice, line, first: index === 0 }));
  });
}

/**
 * "Export to Excel" on the purchase invoice list, two ways (client, 19 Oct 2026):
 * the invoices alone, one row each, as before; or WITH ITEMS, one row per line.
 * Both export the whole filtered list, not the page.
 */
export function InvoiceExportButton({
  params,
  filters,
  invoiceColumns,
}: {
  params: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>;
  filters: ListFilters;
  /** The sheet without items. */
  invoiceColumns: ExportColumn<PurchaseInvoiceRow>[];
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const run = async (withItems: boolean) => {
    setMenu(false);
    setBusy(true);
    setFailed(null);
    try {
      if (!withItems) {
        await downloadGridExcel<PurchaseInvoiceRow>({
          resource: "purchase-invoices",
          params,
          filters,
          columns: invoiceColumns,
          sheetName: "Purchase Invoices",
          fileName: "Purchase-Invoices",
        });
        return;
      }
      const invoices = await fetchAllRows<PurchaseInvoiceRow>("purchase-invoices", params, filters);
      const lines: PurchaseInvoiceExportLine[] = [];
      for (let at = 0; at < invoices.length; at += PURCHASE_INVOICE_LINES_MAX_IDS) {
        const ids = invoices.slice(at, at + PURCHASE_INVOICE_LINES_MAX_IDS).map((invoice) => invoice.id);
        const page = await apiRequest("/purchase-invoices/lines", {
          method: "POST",
          body: { ids },
          schema: purchaseInvoiceLinesResponseSchema,
        });
        lines.push(...page.lines);
      }
      await downloadGridExcel<InvoiceLineRow>({
        resource: "purchase-invoices",
        columns: WITH_ITEMS_COLUMNS,
        rows: toLineRows(invoices, lines),
        sheetName: "Purchase Invoice Items",
        fileName: "Purchase-Invoices-with-Items",
      });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(false);
    }
  };

  const choice =
    "block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700";

  return (
    <span ref={box} className="relative inline-flex items-center gap-2">
      <Button
        variant="secondary"
        icon={FileSpreadsheet}
        loading={busy}
        loadingLabel="Exporting…"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        Export to Excel
        <ChevronDown aria-hidden className="size-3.5" />
      </Button>
      {menu && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg bg-white py-1 shadow-pop ring-1 ring-slate-200">
          <button type="button" role="menuitem" className={choice} onClick={() => void run(false)}>
            Invoices only
            <span className="block text-xs text-slate-500">One row per invoice</span>
          </button>
          <button type="button" role="menuitem" className={choice} onClick={() => void run(true)}>
            With items
            <span className="block text-xs text-slate-500">One row per item of each invoice</span>
          </button>
        </div>
      )}
      {failed && (
        <span role="alert" className="text-sm text-red-700">
          {failed}
        </span>
      )}
    </span>
  );
}
