import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileDown, LoaderCircle, Printer } from "lucide-react";
import { presetLayout, type DocumentType, type PrintBundle, type TemplateLayout } from "@accountmanagement/contracts";
import { Alert, Button, IconButton } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { describeLoadError } from "../../lib/load-error";
import { printBundleQuery } from "./api";

/**
 * The layout a document prints with when nobody chooses one: the company's
 * default, else the every-company default, else the built-in Classic — the same
 * order the print page follows, so a PDF saved from a list matches the page.
 */
export function defaultLayout(bundle: PrintBundle, documentType: DocumentType): TemplateLayout {
  const chosen = bundle.templates.find((template) => template.id === bundle.defaultTemplateId);
  return chosen?.layout ?? presetLayout("classic", documentType);
}

export interface DocumentPdf {
  download: (documentType: DocumentType, id: string) => Promise<void>;
  /** The document being saved, so only its button shows it working. */
  busyId: string | null;
  error: string | null;
  dismiss: () => void;
}

/**
 * Saving a PDF straight from a list, for one screen.
 *
 * ONE PER SCREEN, not one per row, so the error has a single place to appear —
 * above the grid, where the page's other errors are — rather than inside a table
 * cell too narrow to hold a sentence.
 */
export function useDocumentPdf(): DocumentPdf {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(
    async (documentType: DocumentType, id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const bundle = await queryClient.fetchQuery(printBundleQuery(documentType, id));
        // Imported here, on the click, so the PDF libraries never load with a list.
        const { saveDocumentPdf } = await import("./pdf");
        await saveDocumentPdf(defaultLayout(bundle, documentType), bundle.document);
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? describeLoadError(caught, "this document")
            : "The PDF could not be made in this browser. Use Print, and choose Save as PDF there.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [queryClient],
  );

  const dismiss = useCallback(() => setError(null), []);
  // Stable between renders, because the grids list it among their columns' inputs.
  return useMemo(() => ({ download, busyId, error, dismiss }), [download, busyId, error, dismiss]);
}

/** Where a list shows a PDF that failed. Nothing when nothing failed. */
export function DocumentPdfError({ pdf }: { pdf: DocumentPdf }) {
  if (!pdf.error) return null;
  return (
    <Alert className="mb-4">
      <span>{pdf.error}</span>{" "}
      <button type="button" onClick={pdf.dismiss} className="font-medium underline">
        Dismiss
      </button>
    </Alert>
  );
}

/**
 * Download PDF inside an open order or invoice, in the form's footer.
 *
 * THE SAVED DOCUMENT, NOT THE FORM. The PDF is drawn from what the server holds,
 * so while the form has unsaved changes the button waits and says why — a PDF
 * that silently left out what was just typed would be sent to a supplier as if
 * it were the order.
 *
 * No Print here: the print page replaces the form, and anything unsaved would
 * go with it. Print is on the list, beside the row.
 */
export function SavedDocumentPdfButton({
  documentType,
  id,
  dirty,
}: {
  documentType: DocumentType;
  id: string;
  dirty: boolean;
}) {
  const pdf = useDocumentPdf();
  const busy = pdf.busyId === id;

  return (
    <>
      <Button
        variant="secondary"
        type="button"
        icon={FileDown}
        disabled={dirty || pdf.busyId !== null}
        onClick={() => void pdf.download(documentType, id)}
      >
        {busy ? "Saving PDF…" : "Download PDF"}
      </Button>
      {dirty && <span className="text-xs text-slate-500">Save first to include your changes</span>}
      {pdf.error && (
        <span role="alert" className="text-xs text-rose-700">
          {pdf.error}
        </span>
      )}
    </>
  );
}

/**
 * Download PDF and Print, for one row of a list.
 *
 * Shown to everyone who can see the row: the list is already behind the
 * document's view right, and the print route asks for that same right again.
 * Icons, like the Edit and Delete beside them, each naming its document in full.
 */
export function DocumentActions({
  pdf,
  documentType,
  id,
  label,
}: {
  pdf: DocumentPdf;
  documentType: DocumentType;
  id: string;
  /** The document's number, so every button's name is unique in the table. */
  label: string;
}) {
  const navigate = useNavigate();
  const busy = pdf.busyId === id;

  return (
    <>
      <IconButton
        label={busy ? `Saving the PDF of ${label}` : `Download PDF of ${label}`}
        icon={busy ? LoaderCircle : FileDown}
        aria-busy={busy || undefined}
        // One at a time: two photographs drawn at once only make both slower.
        disabled={pdf.busyId !== null}
        onClick={() => void pdf.download(documentType, id)}
        className={busy ? "size-9 lg:size-7 [&>svg]:animate-spin" : "size-9 lg:size-7"}
      />
      <IconButton
        label={`Print ${label}`}
        icon={Printer}
        onClick={() => navigate(`/print/${documentType}/${id}`)}
        className="size-9 lg:size-7"
      />
    </>
  );
}
