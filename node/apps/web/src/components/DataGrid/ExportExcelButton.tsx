import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "../ui";
import { downloadGridExcel, type ExportColumn } from "../../lib/grid-export";
import type { ListFilters, ListParams } from "../../lib/list-query";

/**
 * "Export to Excel" for a list screen — the whole filtered set, not the page.
 *
 * It sits in the grid's `actions` slot. While it works it disables itself: the
 * download is a `fetch`, so nothing in the browser shows that anything is
 * happening, and a person who sees nothing clicks again — each click re-reading
 * the whole list. A refusal (more rows than a sheet should hold) is shown in
 * words beside the button rather than swallowed.
 */
export function ExportExcelButton<T>({
  resource,
  params,
  filters,
  columns,
  sheetName,
  fileName,
  rows,
  disabled = false,
}: {
  /** The list's API resource, e.g. `suppliers`. */
  resource: string;
  /** The screen's `listParams`; only the sort and the search are used. Not needed with `rows`. */
  params?: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>;
  filters?: ListFilters;
  columns: ExportColumn<T>[];
  sheetName: string;
  fileName: string;
  /** A screen that already holds its whole set passes it and skips the fetch. */
  rows?: T[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await downloadGridExcel<T>({ resource, params, filters, columns, sheetName, fileName, rows });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        icon={FileSpreadsheet}
        loading={busy}
        disabled={busy || disabled}
        onClick={() => void run()}
      >
        Export to Excel
      </Button>
      {failed && (
        <span role="alert" className="text-sm text-red-700">
          {failed}
        </span>
      )}
    </span>
  );
}
