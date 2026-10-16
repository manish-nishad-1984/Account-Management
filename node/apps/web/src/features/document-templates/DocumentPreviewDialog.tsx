import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, FileDown, Printer } from "lucide-react";
import { presetLayout, type DocumentType } from "@accountmanagement/contracts";
import { Alert, Button, Modal } from "../../components/ui";
import { describeLoadError } from "../../lib/load-error";
import { usePrintBundle } from "./api";
import { DocumentRenderer, DocumentStyles } from "./render/DocumentRenderer";

const BUILT_IN = "built-in";

/**
 * A saved order or invoice as it will print, in a popup (client request,
 * 16 Oct 2026: preview it rather than download it).
 *
 * The layout is the document's default, and can be switched here. Download PDF
 * and Print are inside, for after it has been looked at. Print leaves the screen
 * for the print page, so the form that opened this passes `allowPrint={false}`:
 * anything unsaved in it would go with it.
 */
export function DocumentPreviewDialog({
  open,
  onClose,
  documentType,
  id,
  allowPrint = true,
}: {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  id: string | null;
  allowPrint?: boolean;
}) {
  const navigate = useNavigate();
  const bundle = usePrintBundle(documentType, open ? id : null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const templates = bundle.data?.templates ?? [];
  const templateId = chosen ?? bundle.data?.defaultTemplateId ?? BUILT_IN;
  const template = templates.find((t) => t.id === templateId);
  const layout = useMemo(() => template?.layout ?? presetLayout("classic", documentType), [template, documentType]);

  const close = () => {
    setChosen(null);
    setPdfError(null);
    onClose();
  };

  const downloadPdf = async () => {
    if (!bundle.data) return;
    setSaving(true);
    setPdfError(null);
    try {
      // Loaded on the click, so the PDF libraries never load with a list.
      const { saveDocumentPdf } = await import("./pdf");
      await saveDocumentPdf(layout, bundle.data.document);
    } catch {
      setPdfError("The PDF could not be made in this browser. Use Print, and choose Save as PDF there.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title={bundle.data ? `Preview · ${bundle.data.document.title} ${bundle.data.document.number}` : "Preview"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button variant="secondary" icon={FileDown} onClick={() => void downloadPdf()} disabled={!bundle.data} loading={saving}>
            Download PDF
          </Button>
          {allowPrint && id && (
            <Button icon={Printer} onClick={() => navigate(`/print/${documentType}/${id}`)} disabled={!bundle.data}>
              Print
            </Button>
          )}
        </>
      }
    >
      <DocumentStyles />
      {templates.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="preview-layout" className="text-xs font-medium text-slate-600">
            Layout
          </label>
          <select
            id="preview-layout"
            value={template ? template.id : BUILT_IN}
            onChange={(event) => setChosen(event.target.value)}
            className="h-8 rounded-md border-0 bg-white px-2.5 pr-8 text-sm text-slate-800 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === bundle.data?.defaultTemplateId ? " (default)" : ""}
              </option>
            ))}
            <option value={BUILT_IN}>Classic (built in)</option>
          </select>
        </div>
      )}
      {pdfError && <Alert className="mb-3">{pdfError}</Alert>}
      {bundle.isError ? (
        <Alert>{describeLoadError(bundle.error, "this document")}</Alert>
      ) : bundle.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-slate-500">
          Loading…
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg bg-slate-100 p-4">
          <div className="mx-auto w-fit shadow-lg" aria-label="Document preview" role="region">
            <DocumentRenderer layout={layout} document={bundle.data.document} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Preview, inside an open order or invoice, in the form's footer. Like the PDF
 * button it replaces, it shows the SAVED document, so it waits while the form has
 * unsaved changes and says why.
 */
export function SavedDocumentPreviewButton({
  documentType,
  id,
  dirty,
}: {
  documentType: DocumentType;
  id: string;
  dirty: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" type="button" icon={Eye} disabled={dirty} onClick={() => setOpen(true)}>
        Preview
      </Button>
      {dirty && <span className="text-xs text-slate-500">Save first to include your changes</span>}
      <DocumentPreviewDialog open={open} onClose={() => setOpen(false)} documentType={documentType} id={id} allowPrint={false} />
    </>
  );
}
