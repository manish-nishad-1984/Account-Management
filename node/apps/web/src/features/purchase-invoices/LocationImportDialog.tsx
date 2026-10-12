import { useRef, useState } from "react";
import {
  PURCHASE_INVOICE_LOCATION_COLUMNS,
  PURCHASE_INVOICE_SHEET_ACCEPT,
  type PurchaseInvoiceSheetResult,
} from "@accountmanagement/contracts";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, Modal } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { downloadGridExcel, type ExportColumn } from "../../lib/grid-export";
import { locationImportRejectionFrom, useImportInvoiceLocations } from "./api";

type SampleRow = string[];

/** The sample file's layout and two made-up rows, so a person can see what to fill. */
const SAMPLE_COLUMNS: ExportColumn<SampleRow>[] = [
  { header: "Invoice no", width: 18, value: (row) => row[0] },
  { header: "Supplier", width: 30, value: (row) => row[1] },
  { header: "Site location", width: 22, value: (row) => row[2] },
  { header: "Shipping address", width: 44, value: (row) => row[3] },
];
const SAMPLE_ROWS: SampleRow[] = [
  ["GENT/26-27/57", "GIRIRAJ ENTERPRISE", "Block A", "Plot 5, Near Main Gate, Surat 395007"],
  ["BI/163/26-27", "BHAGAWATI INDUSTRIES", "Store yard", "Survey 21, Akwada Road, Surat"],
];

/**
 * "Import locations" — sets the site location and shipping address of the
 * invoices a spreadsheet names (client, 12 Oct 2026).
 *
 * All or nothing, and every bad row is listed with its Excel row number, so the
 * file is fixed once rather than once per problem.
 */
export function LocationImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState<PurchaseInvoiceSheetResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const importer = useImportInvoiceLocations();

  const rejection = locationImportRejectionFrom(importer.error);
  const message = importer.error instanceof ApiError && !rejection ? importer.error.message : null;

  const [sampleError, setSampleError] = useState<string | null>(null);
  const downloadSample = () => {
    setSampleError(null);
    downloadGridExcel<SampleRow>({
      resource: "purchase-invoices",
      columns: SAMPLE_COLUMNS,
      rows: SAMPLE_ROWS,
      sheetName: "Invoice locations",
      fileName: "Invoice-locations-sample",
    }).catch(() => setSampleError("The sample file could not be produced."));
  };

  const close = () => {
    setFile(null);
    setDone(null);
    importer.reset();
    if (input.current) input.current.value = "";
    onClose();
  };

  const submit = async () => {
    if (!file) return;
    const result = await importer.mutateAsync(file).catch(() => null);
    if (result) setDone(result);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import locations"
      description="Set the site location and shipping address of existing invoices from a spreadsheet"
      size="lg"
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon={Upload} onClick={submit} disabled={!file} loading={importer.isPending}>
              Upload
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success" icon={CheckCircle2}>
          Updated {done.updated} {done.updated === 1 ? "invoice" : "invoices"} from {done.rowCount}{" "}
          {done.rowCount === 1 ? "row" : "rows"}.
        </Alert>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="invoice-location-file" className="mb-1.5 block text-sm font-medium text-slate-700">
              Spreadsheet
            </label>
            <input
              ref={input}
              id="invoice-location-file"
              type="file"
              accept={PURCHASE_INVOICE_SHEET_ACCEPT}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                importer.reset();
              }}
              className="block w-full cursor-pointer rounded-lg border border-slate-200 text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p className="flex items-center gap-1.5 font-medium text-slate-700">
              <FileSpreadsheet aria-hidden className="size-3.5" />
              Columns (first sheet, headings in row 1)
            </p>
            <p className="mt-1.5">
              {PURCHASE_INVOICE_LOCATION_COLUMNS.map((column, i) => (
                <span key={column.key}>
                  {i > 0 && <span className="text-slate-400"> · </span>}
                  <span className={column.required ? "font-medium text-slate-700" : ""}>{column.header}</span>
                </span>
              ))}
            </p>
            <Button type="button" variant="secondary" icon={FileSpreadsheet} className="mt-2" onClick={downloadSample}>
              Download sample file
            </Button>
            {sampleError && <p className="mt-1 text-rose-700">{sampleError}</p>}
            <p className="mt-1.5 text-slate-500">
              An invoice is found by its <strong>Invoice no</strong> and <strong>Supplier</strong>. The
              location must be one of that invoice&apos;s site. A blank location or shipping cell leaves
              that field as it is.
            </p>
          </div>

          {message && <Alert icon={AlertTriangle}>{message}</Alert>}

          {rejection && (
            <div>
              <Alert icon={AlertTriangle}>
                Nothing was imported. Fix {rejection.errors.length}{" "}
                {rejection.errors.length === 1 ? "problem" : "problems"} and upload again.
              </Alert>
              <div className="relative mt-3 max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Row</th>
                      <th scope="col" className="px-3 py-2 font-medium">Column</th>
                      <th scope="col" className="px-3 py-2 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rejection.errors.map((error, i) => (
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
        </div>
      )}
    </Modal>
  );
}
