import { useState } from "react";
import { FileSpreadsheet, FileText, Users } from "lucide-react";
import { Button } from "../../components/ui";
import { downloadReport, type ReportQuery } from "./api";

/**
 * The Export To Excel / Export To Pdf pair, and the ledger's third button.
 *
 * One component for all three panels, because the legacy versions are three
 * near-identical copies of the same two buttons and the copies have drifted:
 * the sales report's pair posts to different actions from the payout summary's,
 * and only the Payment Report has the party-grouped one.
 *
 * WHAT EACH BUTTON DOES WHILE IT IS WORKING. The download is a `fetch`, so
 * nothing in the browser's own chrome shows that anything is happening — no
 * spinner in the tab, no progress bar, and no file until the whole report has
 * been queried and rendered. A person who clicks Export and sees nothing clicks
 * again, and each click runs the entire report. So every button in the group
 * disables while one is running, and the one that was clicked says so.
 */
export function ExportButtons({
  kind,
  query,
  withByParty = false,
}: {
  kind: "ledger" | "balances" | "sales";
  query: ReportQuery;
  /** The ledger's "Supplier Excel" — one section and one total per party. */
  withByParty?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (format: "xlsx" | "pdf" | "by-party") => {
    setBusy(format);
    setFailed(null);
    try {
      await downloadReport(kind, format, query);
    } catch (error) {
      // The server refuses an export above its row cap with a sentence naming
      // the count and what to narrow. Showing that beats a button that does
      // nothing when pressed.
      setFailed(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        icon={FileSpreadsheet}
        loading={busy === "xlsx"}
        disabled={busy !== null}
        onClick={() => void run("xlsx")}
      >
        Export to Excel
      </Button>

      <Button
        type="button"
        variant="secondary"
        icon={FileText}
        loading={busy === "pdf"}
        disabled={busy !== null}
        onClick={() => void run("pdf")}
      >
        Export to PDF
      </Button>

      {withByParty && (
        <Button
          type="button"
          variant="secondary"
          icon={Users}
          loading={busy === "by-party"}
          disabled={busy !== null}
          onClick={() => void run("by-party")}
        >
          Excel by party
        </Button>
      )}

      {failed && (
        <p role="alert" className="text-xs text-rose-700">
          {failed}
        </p>
      )}
    </div>
  );
}
