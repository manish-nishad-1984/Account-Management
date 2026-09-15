import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { DOCUMENT_TYPES, presetLayout, type DocumentType } from "@accountmanagement/contracts";
import { Alert, Button } from "../../components/ui";
import { describeLoadError } from "../../lib/load-error";
import { usePrintBundle } from "./api";
import { DocumentRenderer, DocumentStyles, pageSizeMm } from "./render/DocumentRenderer";

const BUILT_IN = "built-in";

/**
 * One document, on its own page, ready for the browser's Print — which is also
 * how it is saved as a PDF.
 *
 * OUTSIDE THE APP SHELL, so there is no sidebar or header to hide from the
 * printout, and the page on screen is the page on paper.
 *
 * PRINTED BY THE BROWSER, not made on the server. Nothing heavy runs on the
 * VPS that also carries the live business, and the browser's print dialog
 * already offers Save as PDF.
 *
 * `?template=` chooses the layout; without it the document's default prints.
 * The choice is kept in the address, so the page can be bookmarked or reloaded
 * with the same layout.
 */
export function PrintDocumentPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const documentType = DOCUMENT_TYPES.find((type) => type === params.documentType) as DocumentType | undefined;
  const bundle = usePrintBundle(documentType ?? "sales-invoice", documentType && params.id ? params.id : null);

  const chosen = search.get("template");
  const templates = bundle.data?.templates ?? [];
  const templateId = chosen ?? bundle.data?.defaultTemplateId ?? BUILT_IN;
  const template = templates.find((t) => t.id === templateId);

  const layout = useMemo(
    () => template?.layout ?? presetLayout("classic", documentType ?? "sales-invoice"),
    [template, documentType],
  );
  const page = pageSizeMm(layout.page);

  if (!documentType) {
    return (
      <div className="p-6">
        <Alert>There is nothing to print at this address.</Alert>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-700 underline">
          Back to the dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <DocumentStyles />
      {/*
        The sheet's size and margins, for the printer. The margins live here
        rather than as padding on the page so a second sheet gets them too.
      */}
      <style>{`
        @page { size: ${layout.page.size} ${layout.page.orientation}; margin: ${layout.page.marginMm}mm; }
        @media print {
          html, body { background: #fff !important; }
          .dt-print-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; }
          .dt-print-sheet .dt-page { padding: 0 !important; width: auto !important; min-height: 0 !important; }
        }
      `}</style>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 shadow-sm print:hidden">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate(-1)}>
          Back
        </Button>
        <span className="text-sm font-medium text-slate-800">
          {bundle.data ? `${bundle.data.document.title} · ${bundle.data.document.number}` : "Print"}
        </span>
        <span className="flex-1" />
        <label htmlFor="print-template" className="text-xs font-medium text-slate-600">
          Layout
        </label>
        <select
          id="print-template"
          value={template ? template.id : BUILT_IN}
          onChange={(event) => setSearch({ template: event.target.value }, { replace: true })}
          disabled={!bundle.data}
          className="h-8 rounded-md border-0 bg-white px-2.5 pr-8 text-sm text-slate-800 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === bundle.data?.defaultTemplateId ? " (default)" : ""}
            </option>
          ))}
          <option value={BUILT_IN}>
            Classic (built in){bundle.data?.defaultTemplateId === null ? " (default)" : ""}
          </option>
        </select>
        <Button icon={Printer} onClick={() => window.print()} disabled={!bundle.data}>
          Print / Save PDF
        </Button>
      </div>

      {bundle.isError ? (
        <div className="p-6 print:hidden">
          <Alert>{describeLoadError(bundle.error, "this document")}</Alert>
        </div>
      ) : bundle.isPending ? (
        <p role="status" className="p-10 text-center text-sm text-slate-500 print:hidden">
          Loading…
        </p>
      ) : (
        <div className="overflow-x-auto p-6 print:overflow-visible print:p-0">
          <div className="dt-print-sheet mx-auto shadow-lg" style={{ width: `${page.width}mm` }}>
            <DocumentRenderer layout={layout} document={bundle.data.document} />
          </div>
        </div>
      )}
    </div>
  );
}
