import { useRef, useState } from "react";
import {
  SITE_LOCATION_SHEET_ACCEPT,
  SITE_LOCATION_SHEET_COLUMNS,
  type SiteLocationSheetResult,
} from "@accountmanagement/contracts";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, Modal } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { ApiError } from "../../lib/api-client";
import { downloadGridExcel, type ExportColumn } from "../../lib/grid-export";
import { siteLocationImportRejectionFrom, useImportSiteLocations } from "./api";

type SampleRow = string[];

/** The sample file's layout and two made-up rows, so a person can see what to fill. */
const SAMPLE_COLUMNS: ExportColumn<SampleRow>[] = [
  { header: "Site location", width: 22, value: (row) => row[0] },
  { header: "Location Address", width: 50, value: (row) => row[1] },
];
const SAMPLE_ROWS: SampleRow[] = [
  ["Block A", "Plot 5, Near Main Gate, Surat 395007"],
  ["Store yard", "Survey 21, Akwada Road, Surat"],
];

/**
 * "Import locations" — a spreadsheet of locations and their Location Address,
 * applied to the site chosen in the top header (client, 14 Oct 2026).
 *
 * All or nothing, and every bad row is listed with its Excel row number, so the
 * file is fixed once rather than once per problem.
 */
export function LocationImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scope = useSiteScope();
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState<SiteLocationSheetResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const importer = useImportSiteLocations();

  const rejection = siteLocationImportRejectionFrom(importer.error);
  const message = importer.error instanceof ApiError && !rejection ? importer.error.message : null;

  const [sampleError, setSampleError] = useState<string | null>(null);
  const downloadSample = () => {
    setSampleError(null);
    downloadGridExcel<SampleRow>({
      resource: "site-locations",
      columns: SAMPLE_COLUMNS,
      rows: SAMPLE_ROWS,
      sheetName: "Site locations",
      fileName: "Site-locations-sample",
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
    if (!file || !scope.siteId) return;
    const result = await importer.mutateAsync({ file, siteId: scope.siteId }).catch(() => null);
    if (result) setDone(result);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import locations"
      description="Add locations and set their Location Address from a spreadsheet"
      size="lg"
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon={Upload} onClick={submit} disabled={!file || !scope.siteId} loading={importer.isPending}>
              Upload
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success" icon={CheckCircle2}>
          {done.created} added, {done.updated} updated, from {done.rowCount} {done.rowCount === 1 ? "row" : "rows"}.
        </Alert>
      ) : (
        <div className="space-y-4">
          {scope.siteId ? (
            <Alert tone="info">
              Locations will go to the site <strong>{scope.siteName}</strong>, the one chosen in the top header.
            </Alert>
          ) : (
            <Alert icon={AlertTriangle}>Choose one site in the top header first. The sheet is applied to that site.</Alert>
          )}

          <div>
            <label htmlFor="site-location-file" className="mb-1.5 block text-sm font-medium text-slate-700">
              Spreadsheet
            </label>
            <input
              ref={input}
              id="site-location-file"
              type="file"
              accept={SITE_LOCATION_SHEET_ACCEPT}
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
              {SITE_LOCATION_SHEET_COLUMNS.map((column, i) => (
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
              A <strong>Site location</strong> the site already has takes the new <strong>Location Address</strong>;
              a new name is added. A blank address cell leaves the address as it is. Nothing is removed.
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
