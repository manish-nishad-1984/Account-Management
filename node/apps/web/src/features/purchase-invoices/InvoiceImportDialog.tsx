import { useRef, useState } from "react";
import {
  PURCHASE_INVOICE_IMPORT_ACCEPT,
  PURCHASE_INVOICE_IMPORT_COLUMNS,
  type PurchaseInvoiceImportPreview,
  type PurchaseInvoiceImportResult,
} from "@accountmanagement/contracts";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, CheckboxField, Modal } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import { downloadGridExcel, type ExportColumn } from "../../lib/grid-export";
import { importRejectionFrom, useImportInvoices, usePreviewInvoiceImport } from "./api";

type SampleRow = string[];

const RIGHT = new Set(["Quantity", "Rate", "Discount per unit", "Discount %", "GST %", "TDS", "Adjustment", "Invoice total"]);

/** The sample file: every heading, and two made-up invoices (one of two lines) to show how rows are filled. */
const SAMPLE_COLUMNS: ExportColumn<SampleRow>[] = PURCHASE_INVOICE_IMPORT_COLUMNS.map((column, i) => ({
  header: column.header,
  width: Math.max(12, column.header.length + 4),
  align: RIGHT.has(column.header) ? ("right" as const) : ("left" as const),
  value: (row: SampleRow) => row[i],
}));
// Order: Invoice no, Date, Supplier, Company, Site, Site location, Type, Challan no, Shipping address,
//        Item, Unit, Quantity, Rate, Discount per unit, Discount %, GST %, TDS, Adjustment, Invoice total
const SAMPLE_ROWS: SampleRow[] = [
  ["GENT/26-27/57", "05-10-2026", "GIRIRAJ ENTERPRISE", "DH PATEL", "SURAT-AURO UNIVERSITY", "Block A", "Purchase", "CH-114", "Plot 5, Near Main Gate, Surat", "OPC 53 Grade Cement", "Bag", "100", "395.00", "", "", "18", "", "", ""],
  ["GENT/26-27/57", "", "", "", "", "", "", "", "", "River Sand", "Brass", "2", "5200.00", "", "2", "5", "200.00", "-3.00", "57,109.00"],
  ["BI/163/26-27", "21-09-2026", "BHAGAWATI INDUSTRIES", "DH PATEL", "SURAT-AURO UNIVERSITY", "", "", "", "", "Fly Ash Bricks", "Nos", "5000", "6.50", "", "", "12", "", "", ""],
];

const RULES = [
  "One row per item line. Rows with the same Supplier and Invoice no are one invoice; fill its Date, Company, Site and the like once, on its first row.",
  "Each line: (Rate − discount) × Quantity, with GST % on that. Every figure is rounded to paise per line.",
  "Discount: either Discount per unit (rupees) or Discount % (a percent of the Rate, turned into rupees per unit and rounded to paise) - not both on one line.",
  "Invoice total = lines + GST − TDS + Adjustment, rounded to a WHOLE RUPEE: exactly .50 goes down, above .50 goes up.",
  "Fill Invoice total from the paper bill to have it checked: a bill whose lines do not come to it is refused.",
];

/**
 * "Import invoices" — a month's purchase invoices from one spreadsheet
 * (client, 14 Oct 2026), in two steps so the totals are looked at before
 * anything is saved:
 *
 *   1. CHECK: the server prices every invoice with the invoice form's own
 *      arithmetic and answers with a summary, or every problem with its row.
 *   2. IMPORT: only after the person has ticked that the count and grand total
 *      are right. The same file is sent with those two numbers, and the server
 *      refuses if it no longer comes to them.
 */
export function InvoiceImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PurchaseInvoiceImportPreview | null>(null);
  const [done, setDone] = useState<PurchaseInvoiceImportResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const checker = usePreviewInvoiceImport();
  const importer = useImportInvoices();

  // A refused import (a file that changed, or a problem found at the last moment) comes back as a preview.
  const rejection = importRejectionFrom(importer.error) ?? importRejectionFrom(checker.error);
  const shown = rejection ?? preview;
  const message =
    [importer.error, checker.error].find((e) => e instanceof ApiError && !importRejectionFrom(e))?.message ?? null;

  const reset = () => {
    setPreview(null);
    setVerified(false);
    checker.reset();
    importer.reset();
  };

  const close = () => {
    reset();
    setFile(null);
    setDone(null);
    if (input.current) input.current.value = "";
    onClose();
  };

  const check = async () => {
    if (!file) return;
    reset();
    const result = await checker.mutateAsync(file).catch(() => null);
    if (result) setPreview(result);
  };

  const submit = async () => {
    if (!file || !shown || shown.errors.length > 0) return;
    const result = await importer
      .mutateAsync({ file, count: shown.invoiceCount, total: shown.totals.total })
      .catch(() => null);
    if (result) setDone(result);
  };

  const downloadSample = () => {
    setSampleError(null);
    downloadGridExcel<SampleRow>({
      resource: "purchase-invoices",
      columns: SAMPLE_COLUMNS,
      rows: SAMPLE_ROWS,
      sheetName: "Purchase invoices",
      fileName: "Purchase-invoices-import-sample",
    }).catch(() => setSampleError("The sample file could not be produced."));
  };

  const clean = shown !== null && shown.errors.length === 0 && shown.invoiceCount > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import invoices"
      description="Bring in many purchase invoices at once from a spreadsheet"
      size="xl"
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              icon={Upload}
              onClick={check}
              disabled={!file}
              loading={checker.isPending}
            >
              Check file
            </Button>
            <Button onClick={submit} disabled={!clean || !verified} loading={importer.isPending}>
              {clean ? `Import ${shown!.invoiceCount} ${shown!.invoiceCount === 1 ? "invoice" : "invoices"}` : "Import"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success" icon={CheckCircle2}>
          Imported {done.created} {done.created === 1 ? "invoice" : "invoices"} totalling {formatMoney(done.total)}.
        </Alert>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="invoice-import-file" className="mb-1.5 block text-sm font-medium text-slate-700">
              Spreadsheet
            </label>
            <input
              ref={input}
              id="invoice-import-file"
              type="file"
              accept={PURCHASE_INVOICE_IMPORT_ACCEPT}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                reset();
              }}
              className="block w-full cursor-pointer rounded-lg border border-slate-200 text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>

          {!shown && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="flex items-center gap-1.5 font-medium text-slate-700">
                <FileSpreadsheet aria-hidden className="size-3.5" />
                Columns (first sheet, headings in row 1)
              </p>
              <p className="mt-1.5">
                {PURCHASE_INVOICE_IMPORT_COLUMNS.map((column, i) => (
                  <span key={column.key}>
                    {i > 0 && <span className="text-slate-400"> · </span>}
                    <span className={column.required ? "font-medium text-slate-700" : ""}>{column.header}</span>
                  </span>
                ))}
              </p>
              <p className="mt-1 text-slate-500">Bold columns are required.</p>
              <Button type="button" variant="secondary" icon={FileSpreadsheet} className="mt-2" onClick={downloadSample}>
                Download sample file
              </Button>
              {sampleError && <p className="mt-1 text-rose-700">{sampleError}</p>}
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-500">
                {RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          )}

          {message && <Alert icon={AlertTriangle}>{message}</Alert>}

          {shown && shown.errors.length > 0 && (
            <div>
              <Alert icon={AlertTriangle}>
                Nothing can be imported yet. Fix {shown.errors.length} {shown.errors.length === 1 ? "problem" : "problems"} in the
                file and check it again.
              </Alert>
              <div className="relative mt-3 max-h-72 overflow-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Row</th>
                      <th scope="col" className="px-3 py-2 font-medium">Column</th>
                      <th scope="col" className="px-3 py-2 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.errors.map((error, i) => (
                      <tr key={`${error.row}-${i}`}>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-slate-700">{error.row}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{error.column ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-700">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {clean && (
            <div className="space-y-3">
              <dl
                aria-label="Import summary"
                className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-200 sm:grid-cols-4"
              >
                <Figure label="Invoices" value={String(shown.invoiceCount)} />
                <Figure label="Lines" value={String(shown.lineCount)} />
                <Figure label="Subtotal" value={formatMoney(shown.totals.subtotal)} />
                <Figure label="GST" value={formatMoney(shown.totals.totalGst)} />
                <Figure label="TDS" value={formatMoney(shown.totals.tds)} />
                <Figure label="Adjustment" value={formatMoney(shown.totals.adjustment)} />
                <Figure label="Round off" value={formatMoney(shown.totals.roundOff)} />
                <Figure label="Grand total" value={formatMoney(shown.totals.total)} strong />
              </dl>

              <div className="max-h-72 overflow-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 font-medium">Company · Site</th>
                      <th className="px-3 py-2 text-right font-medium">Lines</th>
                      <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                      <th className="px-3 py-2 text-right font-medium">GST</th>
                      <th className="px-3 py-2 text-right font-medium">TDS</th>
                      <th className="px-3 py-2 text-right font-medium">Adj.</th>
                      <th className="px-3 py-2 text-right font-medium">Round off</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.invoices.map((invoice) => (
                      <tr key={invoice.row}>
                        <td className="tabular px-3 py-1.5 text-slate-500">{invoice.row}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900">
                          {invoice.invoiceNo}
                          {invoice.type !== "Purchase" && <span className="ml-1 text-amber-700">({invoice.type})</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{formatDate(invoice.date)}</td>
                        <td className="px-3 py-1.5 text-slate-700">{invoice.supplier}</td>
                        <td className="px-3 py-1.5 text-slate-500">{[invoice.company, invoice.site].filter(Boolean).join(" · ")}</td>
                        <td className="tabular px-3 py-1.5 text-right">{invoice.lineCount}</td>
                        <td className="tabular px-3 py-1.5 text-right">{formatMoney(invoice.subtotal)}</td>
                        <td className="tabular px-3 py-1.5 text-right">{formatMoney(invoice.totalGst)}</td>
                        <td className="tabular px-3 py-1.5 text-right">{formatMoney(invoice.tds)}</td>
                        <td className="tabular px-3 py-1.5 text-right">{formatMoney(invoice.adjustment)}</td>
                        <td className="tabular px-3 py-1.5 text-right">{formatMoney(invoice.roundOff)}</td>
                        <td className="tabular px-3 py-1.5 text-right font-medium text-slate-900">
                          {formatMoney(invoice.total)}
                          {invoice.sheetTotal !== null && (
                            <span className="ml-1 text-emerald-700" title="Matches the Invoice total on the sheet">
                              ✓
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CheckboxField
                label={`I have checked these figures: ${shown.invoiceCount} ${shown.invoiceCount === 1 ? "invoice" : "invoices"} totalling ${formatMoney(shown.totals.total)}`}
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
            </div>
          )}

          {shown && shown.errors.length === 0 && shown.invoiceCount === 0 && (
            <Alert icon={AlertTriangle}>The file has no invoice rows.</Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={strong ? "tabular text-sm font-semibold text-slate-900" : "tabular font-medium text-slate-800"}>{value}</dd>
    </div>
  );
}
