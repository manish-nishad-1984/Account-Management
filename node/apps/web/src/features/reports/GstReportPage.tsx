import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileSpreadsheet, X } from "lucide-react";
import {
  gstReportSchema,
  type GstBillRow,
  type GstRateRow,
  type GstReport,
  type GstSupplierRow,
  type GstWarning,
} from "@accountmanagement/contracts";
import { Alert, Button, PageHeader, SelectField, SummaryStrip, TextField } from "../../components/ui";
import { apiRequest } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import { describeLoadError } from "../../lib/load-error";
import { downloadWorkbook, exportAmount, exportDate, workbookSheet, type ExportColumn } from "../../lib/grid-export";
import { useCompanyOptions } from "../purchase-orders/api";
import { DATE_PRESETS, describeRange, presetDates, presetOf, type DatePreset } from "../exports/date-presets";

/**
 * GST REPORT (client, 22 Oct 2026): the month's INPUT GST from the purchase
 * bills, supplier by supplier, bill by bill and rate by rate — what the CA
 * matches against GSTR-2B. How CGST, SGST and IGST are told apart is in
 * `contracts/gst-report.ts`.
 *
 * Opens on LAST month: the return being prepared is for the month just ended.
 */
type View = "suppliers" | "bills" | "rates";

const VIEWS: { key: View; label: string }[] = [
  { key: "suppliers", label: "Supplier-wise" },
  { key: "bills", label: "Bill-wise" },
  { key: "rates", label: "Rate-wise" },
];

const PRESETS: DatePreset[] = ["lastMonth", "month", "fy", "lastFy"];

const WARNING_TEXT: Record<GstWarning["problem"], string> = {
  "supplier-gstin-missing": "Supplier has no GSTIN",
  "supplier-gstin-invalid": "Supplier's GSTIN is not valid",
  "company-gstin-missing": "Company has no valid GSTIN",
};

const taxColumns = <T extends { taxable: string; cgst: string; sgst: string; igst: string; totalGst: string }>(): ExportColumn<T>[] => [
  { header: "Taxable value", width: 16, align: "right", value: (row) => exportAmount(row.taxable) },
  { header: "CGST", width: 14, align: "right", value: (row) => exportAmount(row.cgst) },
  { header: "SGST", width: 14, align: "right", value: (row) => exportAmount(row.sgst) },
  { header: "IGST", width: 14, align: "right", value: (row) => exportAmount(row.igst) },
  { header: "Total GST", width: 14, align: "right", value: (row) => exportAmount(row.totalGst) },
];

export const SUPPLIER_COLUMNS: ExportColumn<GstSupplierRow>[] = [
  { header: "Supplier", width: 34, value: (row) => row.supplierName },
  { header: "GSTIN", width: 18, value: (row) => row.supplierGstin },
  { header: "Bills", width: 8, align: "right", value: (row) => String(row.billCount) },
  ...taxColumns<GstSupplierRow>(),
];

export const BILL_COLUMNS: ExportColumn<GstBillRow>[] = [
  { header: "Bill date", width: 12, value: (row) => exportDate(row.date) },
  { header: "Bill no.", width: 18, value: (row) => row.billNo },
  { header: "Type", width: 12, value: (row) => row.invoiceType },
  { header: "Supplier", width: 32, value: (row) => row.supplierName },
  { header: "Supplier GSTIN", width: 18, value: (row) => row.supplierGstin },
  { header: "Company", width: 24, value: (row) => row.companyName },
  { header: "Our GSTIN", width: 18, value: (row) => row.companyGstin },
  { header: "Our no.", width: 18, value: (row) => row.ourNo },
  { header: "GST %", width: 8, align: "right", value: (row) => exportAmount(row.gstPercent) },
  ...taxColumns<GstBillRow>(),
];

export const RATE_COLUMNS: ExportColumn<GstRateRow>[] = [
  { header: "GST %", width: 10, align: "right", value: (row) => exportAmount(row.gstPercent) },
  ...taxColumns<GstRateRow>(),
];

const WARNING_COLUMNS: ExportColumn<GstWarning>[] = [
  { header: "Problem", width: 30, value: (row) => WARNING_TEXT[row.problem] },
  { header: "Name", width: 34, value: (row) => row.name },
  { header: "GSTIN on record", width: 20, value: (row) => row.gstin },
  { header: "Bills", width: 8, align: "right", value: (row) => String(row.billCount) },
];

const toSearch = (query: { companyId: string; fromDate: string; toDate: string }) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export function GstReportPage() {
  const today = useMemo(() => new Date(), []);
  const [companyId, setCompanyId] = useState("");
  const [{ fromDate, toDate }, setDates] = useState(() => presetDates("lastMonth", today));
  const [view, setView] = useState<View>("suppliers");
  const [supplier, setSupplier] = useState<GstSupplierRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const companies = useCompanyOptions();

  const query = { companyId, fromDate, toDate };
  const report = useQuery({
    queryKey: ["reports", "gst", query],
    queryFn: ({ signal }) => apiRequest(`/reports/gst${toSearch(query)}`, { schema: gstReportSchema, signal }),
  });
  const data: GstReport | undefined = report.data;
  const preset = presetOf(fromDate, toDate, today);
  const companyName = (companies.data?.rows ?? []).find((row) => row.id === companyId)?.name ?? "All companies";

  const bills = data ? (supplier ? data.bills.filter((row) => row.supplierId === supplier.supplierId) : data.bills) : [];

  const exportExcel = async () => {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      const summary = {
        sheetName: "Summary",
        columns: [
          { header: "GST Report", width: 24, align: "left" as const },
          { header: "", width: 40, align: "left" as const },
        ],
        rows: [
          ["Dates (bill date)", describeRange(fromDate, toDate)],
          ["Company", companyName],
          ["Bills", String(data.totals.billCount)],
          ["Taxable value", exportAmount(data.totals.taxable)],
          ["CGST", exportAmount(data.totals.cgst)],
          ["SGST", exportAmount(data.totals.sgst)],
          ["IGST", exportAmount(data.totals.igst)],
          ["Total GST", exportAmount(data.totals.totalGst)],
          ["", ""],
          ["Note", "Input GST from purchase bills. Credit notes and returns are negative."],
          ["", "Same state as our GSTIN: CGST + SGST; another state: IGST."],
        ],
      };
      const sheets = [
        summary,
        workbookSheet(data.suppliers, SUPPLIER_COLUMNS, "Supplier-wise"),
        workbookSheet(data.bills, BILL_COLUMNS, "Bill-wise"),
        workbookSheet(data.rates, RATE_COLUMNS, "Rate-wise"),
        ...(data.warnings.length > 0 ? [workbookSheet(data.warnings, WARNING_COLUMNS, "GSTIN to fix")] : []),
      ];
      await downloadWorkbook(sheets, `GST-Report-${fromDate || "start"}-to-${toDate || "today"}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setExporting(false);
    }
  };

  const companyOptions = [
    { value: "", label: "All companies" },
    ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];

  return (
    <>
      <PageHeader title="GST Report" description="Input GST from purchase bills, to match with GSTR-2B" />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-60">
          <SelectField label="Company" value={companyId} options={companyOptions} onChange={(event) => setCompanyId(event.target.value)} />
        </div>
        <div className="w-40">
          <TextField label="From (bill date)" type="date" value={fromDate} onChange={(event) => setDates({ fromDate: event.target.value, toDate })} />
        </div>
        <div className="w-40">
          <TextField label="To" type="date" value={toDate} onChange={(event) => setDates({ fromDate, toDate: event.target.value })} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-1" role="group" aria-label="Date range">
          {DATE_PRESETS.filter((choice) => PRESETS.includes(choice.key)).map((choice) => (
            <button
              key={choice.key}
              type="button"
              aria-pressed={preset === choice.key}
              onClick={() => setDates(presetDates(choice.key, today))}
              className={clsx(
                "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
                preset === choice.key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void exportExcel()} loading={exporting} loadingLabel="Exporting…" disabled={!data}>
            Export to Excel
          </Button>
        </div>
      </div>

      {exportError && <Alert className="mb-3">{exportError}</Alert>}
      {report.isError && <Alert className="mb-3">{describeLoadError(report.error, "the GST report")}</Alert>}

      {data && (
        <>
          <SummaryStrip
            className="mb-3"
            items={[
              { label: "Bills", value: data.totals.billCount.toLocaleString("en-IN") },
              { label: "Taxable value", value: formatMoney(data.totals.taxable) },
              { label: "CGST", value: formatMoney(data.totals.cgst) },
              { label: "SGST", value: formatMoney(data.totals.sgst) },
              { label: "IGST", value: formatMoney(data.totals.igst) },
              { label: "Total GST", value: formatMoney(data.totals.totalGst), strong: true },
            ]}
          />

          {data.warnings.length > 0 && (
            <Alert tone="warning" icon={AlertTriangle} className="mb-3">
              <p className="font-medium">These will not match GSTR-2B until the GSTIN is corrected in the master:</p>
              <ul className="mt-1 list-disc pl-5">
                {data.warnings.map((warning) => (
                  <li key={`${warning.problem}-${warning.name}`}>
                    {WARNING_TEXT[warning.problem]}: <strong>{warning.name}</strong>
                    {warning.gstin ? ` (${warning.gstin})` : ""} — {warning.billCount} bill{warning.billCount === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="GST report view" className="inline-flex rounded-md ring-1 ring-inset ring-slate-300">
          {VIEWS.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="tab"
              aria-selected={view === choice.key}
              onClick={() => setView(choice.key)}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md",
                view === choice.key ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {view === "bills" && supplier && (
          <button
            type="button"
            onClick={() => setSupplier(null)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-300"
          >
            {supplier.supplierName}
            <X aria-label="Show every supplier" className="size-3.5" />
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
        {report.isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : !data || data.totals.billCount === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No purchase bills in these dates.</p>
        ) : view === "suppliers" ? (
          <TaxTable
            label="Supplier-wise GST"
            head={["Supplier", "GSTIN", "Bills"]}
            rows={data.suppliers.map((row) => ({
              key: row.supplierId,
              cells: [row.supplierName, row.supplierGstin ?? "—", String(row.billCount)],
              taxes: row,
              onOpen: () => {
                setSupplier(row);
                setView("bills");
              },
            }))}
            total={data.totals}
          />
        ) : view === "bills" ? (
          <TaxTable
            label="Bill-wise GST"
            head={["Bill date", "Bill no.", "Supplier", "GSTIN", "GST %"]}
            rows={bills.map((row) => ({
              key: `${row.invoiceId}-${row.gstPercent}`,
              cells: [
                formatDate(row.date),
                row.invoiceType === "Purchase" ? row.billNo : `${row.billNo} (${row.invoiceType})`,
                row.supplierName,
                row.supplierGstin ?? "—",
                `${Number(row.gstPercent)}%`,
              ],
              taxes: row,
            }))}
            total={supplier ? { ...supplier } : data.totals}
          />
        ) : (
          <TaxTable
            label="Rate-wise GST"
            head={["GST %"]}
            rows={data.rates.map((row) => ({ key: row.gstPercent, cells: [`${Number(row.gstPercent)}%`], taxes: row }))}
            total={data.totals}
          />
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Counted by bill date. Taxable value is each line after discount. Same state as our GSTIN is CGST + SGST, half each; another
        state is IGST. Credit notes and purchase returns are taken off.
      </p>
    </>
  );
}

type TaxFigures = { taxable: string; cgst: string; sgst: string; igst: string; totalGst: string };

function TaxTable({
  label,
  head,
  rows,
  total,
}: {
  label: string;
  head: string[];
  rows: { key: string; cells: string[]; taxes: TaxFigures; onOpen?: () => void }[];
  total: TaxFigures;
}) {
  const money = (value: string) => (
    <td className={clsx("tabular px-3 py-2 text-right", Number(value) < 0 ? "text-rose-700" : "text-slate-800")}>{formatMoney(value)}</td>
  );
  return (
    <table className="w-full min-w-[56rem] text-sm" aria-label={label}>
      <thead className="bg-surface-muted text-xs text-slate-600">
        <tr>
          {head.map((title) => (
            <th key={title} className="px-3 py-2.5 text-left font-medium">
              {title}
            </th>
          ))}
          {["Taxable value", "CGST", "SGST", "IGST", "Total GST"].map((title) => (
            <th key={title} className="px-3 py-2.5 text-right font-medium">
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr
            key={row.key}
            onClick={row.onOpen}
            title={row.onOpen ? "Show this supplier's bills" : undefined}
            className={row.onOpen ? "cursor-pointer hover:bg-slate-50" : undefined}
          >
            {row.cells.map((cell, at) => (
              <td key={at} className={clsx("px-3 py-2", at === 0 ? "font-medium text-slate-900" : "text-slate-700")}>
                {cell}
              </td>
            ))}
            {money(row.taxes.taxable)}
            {money(row.taxes.cgst)}
            {money(row.taxes.sgst)}
            {money(row.taxes.igst)}
            {money(row.taxes.totalGst)}
          </tr>
        ))}
      </tbody>
      <tfoot className="bg-surface-muted font-semibold">
        <tr>
          <td className="px-3 py-2.5 text-slate-900" colSpan={head.length}>
            Total
          </td>
          {money(total.taxable)}
          {money(total.cgst)}
          {money(total.sgst)}
          {money(total.igst)}
          {money(total.totalGst)}
        </tr>
      </tfoot>
    </table>
  );
}
