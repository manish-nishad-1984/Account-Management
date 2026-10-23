import { useRef, useState } from "react";
import { PAYMENT_IMPORT_COLUMNS, type PaymentImportPreview, type PaymentImportResult } from "@accountmanagement/contracts";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, CheckboxField, Modal } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import { downloadGridExcel, type ExportColumn } from "../../lib/grid-export";
import { paymentImportRejectionFrom, useImportPayments, usePreviewPaymentImport } from "./api";

type SampleRow = string[];

/** The sample file: every heading and three made-up payments, on different dates, suppliers and companies. */
const SAMPLE_COLUMNS: ExportColumn<SampleRow>[] = PAYMENT_IMPORT_COLUMNS.map((column, i) => ({
  header: column.header,
  width: Math.max(12, column.header.length + 6),
  align: column.key === "amount" ? ("right" as const) : ("left" as const),
  value: (row: SampleRow) => row[i],
}));
// Order: Date, Supplier, Company, Site, Site location, Amount, Method, Reference no, Description
const SAMPLE_ROWS: SampleRow[] = [
  ["05-10-2026", "GIRIRAJ ENTERPRISE", "DH PATEL", "SURAT-AURO UNIVERSITY", "", "50000.00", "NEFT", "UTR123456", "Cement bills"],
  ["07-10-2026", "BHAGAWATI INDUSTRIES", "DH PATEL", "SURAT-AURO UNIVERSITY", "Block A", "25000.00", "Cheque", "000451", ""],
  ["12-10-2026", "GIRIRAJ ENTERPRISE", "DH PATEL INFRA", "GUJARAT JHM HOTELS-AURO", "", "1,20,000.00", "RTGS", "UTR998877", ""],
];

const RULES = [
  "One row per payment. Each row has its own Date, Supplier, Company and Site.",
  "Names are matched as they are in the masters; capital or small letters do not matter.",
  "A payment already recorded (same supplier, company, site, date, amount and reference) is refused, so a file cannot be imported twice.",
  "The payments settle the oldest bills of the supplier at that site and company, as a payment keyed in does.",
];

/**
 * "Import payments" (client, 23 Oct 2026): many payments, on many dates, for
 * many suppliers and companies, from one spreadsheet. In two steps, as the
 * invoice import: CHECK shows every payment or every problem with its row;
 * IMPORT is allowed once the count and total have been ticked as right.
 */
export function PaymentImportDialog({ open, direction, onClose }: { open: boolean; direction: "out" | "in"; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PaymentImportPreview | null>(null);
  const [done, setDone] = useState<PaymentImportResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const checker = usePreviewPaymentImport();
  const importer = useImportPayments();

  const rejection = paymentImportRejectionFrom(importer.error) ?? paymentImportRejectionFrom(checker.error);
  const shown = rejection ?? preview;
  const message = [importer.error, checker.error].find((e) => e instanceof ApiError && !paymentImportRejectionFrom(e))?.message ?? null;
  const what = direction === "out" ? "payments" : "receipts";

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
    const result = await checker.mutateAsync({ file, direction }).catch(() => null);
    if (result) setPreview(result);
  };

  const submit = async () => {
    if (!file || !shown || shown.errors.length > 0) return;
    const result = await importer.mutateAsync({ file, direction, count: shown.paymentCount, total: shown.total }).catch(() => null);
    if (result) setDone(result);
  };

  const downloadSample = () => {
    setSampleError(null);
    downloadGridExcel<SampleRow>({
      resource: "payments",
      columns: SAMPLE_COLUMNS,
      rows: SAMPLE_ROWS,
      sheetName: "Payments",
      fileName: "Payments-import-sample",
    }).catch(() => setSampleError("The sample file could not be produced."));
  };

  const clean = shown !== null && shown.errors.length === 0 && shown.paymentCount > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title={direction === "out" ? "Import payments" : "Import receipts"}
      description={direction === "out" ? "Record many payments to suppliers at once from a spreadsheet" : "Record many receipts at once from a spreadsheet"}
      size="xl"
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="secondary" icon={Upload} onClick={check} disabled={!file} loading={checker.isPending}>
              Check file
            </Button>
            <Button onClick={submit} disabled={!clean || !verified} loading={importer.isPending}>
              {clean ? `Import ${shown!.paymentCount} ${shown!.paymentCount === 1 ? what.slice(0, -1) : what}` : "Import"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success" icon={CheckCircle2}>
          Imported {done.created} {done.created === 1 ? what.slice(0, -1) : what} totalling {formatMoney(done.total)}.
        </Alert>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="payment-import-file" className="mb-1.5 block text-sm font-medium text-slate-700">
              Spreadsheet
            </label>
            <input
              ref={input}
              id="payment-import-file"
              type="file"
              accept=".xlsx"
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
                {PAYMENT_IMPORT_COLUMNS.map((column, i) => (
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
                Nothing can be imported yet. Fix {shown.errors.length} {shown.errors.length === 1 ? "problem" : "problems"} in the file
                and check it again.
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
              <dl aria-label="Import summary" className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-200">
                <div>
                  <dt className="text-slate-500">{direction === "out" ? "Payments" : "Receipts"}</dt>
                  <dd className="tabular font-medium text-slate-800">{shown.paymentCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Total</dt>
                  <dd className="tabular text-sm font-semibold text-slate-900">{formatMoney(shown.total)}</dd>
                </div>
              </dl>

              <div className="max-h-72 overflow-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 font-medium">Company · Site</th>
                      <th className="px-3 py-2 font-medium">Method · Ref.</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.payments.map((payment) => (
                      <tr key={payment.row}>
                        <td className="tabular px-3 py-1.5 text-slate-500">{payment.row}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{formatDate(payment.date)}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900">{payment.party}</td>
                        <td className="px-3 py-1.5 text-slate-500">{[payment.company, payment.site].filter(Boolean).join(" · ")}</td>
                        <td className="px-3 py-1.5 text-slate-500">{[payment.method, payment.referenceNo].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="tabular px-3 py-1.5 text-right font-medium text-slate-900">{formatMoney(payment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CheckboxField
                label={`I have checked these figures: ${shown.paymentCount} ${shown.paymentCount === 1 ? what.slice(0, -1) : what} totalling ${formatMoney(shown.total)}`}
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
            </div>
          )}

          {shown && shown.errors.length === 0 && shown.paymentCount === 0 && <Alert icon={AlertTriangle}>The file has no payment rows.</Alert>}
        </div>
      )}
    </Modal>
  );
}
