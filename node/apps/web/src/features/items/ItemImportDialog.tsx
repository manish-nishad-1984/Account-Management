import { useRef, useState } from "react";
import {
  ITEM_SHEET_ACCEPT,
  ITEM_SHEET_COLUMNS,
  type ItemSheetImportResult,
} from "@accountmanagement/contracts";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, Modal } from "../../components/ui";
import { importRejectionFrom, useImportItemSheet } from "./api";
import { ApiError } from "../../lib/api-client";

/**
 * "Upload File" — the Item Master's bulk import.
 *
 * The screen's job is to make a REJECTED import useful, which is the half the
 * legacy version does not do. `ImportExcelFile` returns on the first bad row
 * with one sentence — ": Cement at row 1 does not match any data type." — so a
 * catalogue with fifteen unknown units takes fifteen upload-and-wait cycles to
 * clean, and the sentence names the item rather than the column that is wrong.
 * Everything the server found is listed here, in row order, with the column.
 */
export function ItemImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState<ItemSheetImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const importer = useImportItemSheet();

  const rejection = importRejectionFrom(importer.error);
  const message =
    importer.error instanceof ApiError && !rejection ? importer.error.message : null;

  const reset = () => {
    setFile(null);
    setDone(null);
    importer.reset();
    if (input.current) input.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!file) return;
    // `mutateAsync` rejects on a refused import; the error is rendered from
    // `importer.error` either way, so the throw is deliberately swallowed
    // rather than becoming an unhandled rejection.
    const result = await importer.mutateAsync(file).catch(() => null);
    if (result) setDone(result);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload items"
      description="Add items in bulk from a spreadsheet"
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
          Imported {describeCounts(done)} from {done.rowCount}{" "}
          {done.rowCount === 1 ? "row" : "rows"}.
        </Alert>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="item-sheet-file"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Spreadsheet
            </label>
            <input
              ref={input}
              id="item-sheet-file"
              type="file"
              accept={ITEM_SHEET_ACCEPT}
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
              Columns
            </p>
            <p className="mt-1.5">
              {ITEM_SHEET_COLUMNS.map((column, i) => (
                <span key={column.key}>
                  {i > 0 && <span className="text-slate-400"> · </span>}
                  <span className={column.required ? "font-medium text-slate-700" : ""}>
                    {column.header}
                  </span>
                </span>
              ))}
            </p>
            <p className="mt-1.5 text-slate-500">
              Bold columns are required. Use <strong>Download File</strong> to get the catalogue in
              exactly this layout — an exported file can be edited and uploaded straight back.
            </p>
          </div>

          {message && <Alert icon={AlertTriangle}>{message}</Alert>}

          {rejection && <RejectionTable result={rejection} />}
        </div>
      )}
    </Modal>
  );
}

/**
 * Every problem the server found, in row order.
 *
 * A table rather than a list of sentences: the row number is what the user acts
 * on, and it has to be scannable down a column while they work through the file
 * in Excel beside it.
 */
function RejectionTable({ result }: { result: ItemSheetImportResult }) {
  return (
    <div>
      <Alert icon={AlertTriangle}>
        Nothing was imported. Fix {result.errors.length}{" "}
        {result.errors.length === 1 ? "problem" : "problems"} and upload again.
      </Alert>

      <div className="mt-3 max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Row
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Column
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Problem
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.errors.map((error, i) => (
              <tr key={`${error.row}-${error.column}-${i}`}>
                <td className="tabular whitespace-nowrap px-3 py-2 text-slate-700">{error.row}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{error.column ?? "—"}</td>
                <td className="px-3 py-2 text-slate-700">{error.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "12 items", "3 items and 2 restored", "2 restored". */
function describeCounts(result: ItemSheetImportResult): string {
  const parts: string[] = [];
  if (result.created > 0) {
    parts.push(`${result.created} ${result.created === 1 ? "item" : "items"}`);
  }
  if (result.revived > 0) {
    // Worth naming separately: these were previously deleted items whose names
    // matched, and they have been brought back and overwritten with the row.
    parts.push(`${result.revived} previously deleted ${result.revived === 1 ? "item" : "items"}`);
  }
  return parts.join(" and ") || "nothing";
}
