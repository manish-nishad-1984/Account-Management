import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Printer, Search } from "lucide-react";
import {
  listResponseSchema,
  purchaseInvoiceRowSchema,
  salesInvoiceRowSchema,
  type DocumentType,
  type TemplateLayout,
} from "@accountmanagement/contracts";
import { Alert, Modal, TextField } from "../../components/ui";
import { apiRequest } from "../../lib/api-client";
import { formatDate } from "../../lib/format";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { describeLoadError } from "../../lib/load-error";
import { usePermission } from "../../lib/permissions";
import { usePrintBundle } from "./api";
import { DocumentRenderer, DocumentStyles } from "./render/DocumentRenderer";
import { sampleDocument } from "./render/sample-document";

const salesList = listResponseSchema(salesInvoiceRowSchema);
const purchaseList = listResponseSchema(purchaseInvoiceRowSchema);

interface InvoiceChoice {
  id: string;
  label: string;
}

/**
 * Invoices to preview with, found by number or party. The newest first when
 * nothing is typed. Only asked for when the person can open that kind of
 * invoice at all.
 */
function useInvoiceChoices(documentType: DocumentType, search: string, enabled: boolean) {
  return useQuery({
    queryKey: ["document-print", "choices", documentType, search],
    enabled,
    queryFn: async ({ signal }): Promise<InvoiceChoice[]> => {
      const query = `limit=20&sortBy=createdAt&sortDir=desc${search ? `&search=${encodeURIComponent(search)}` : ""}`;
      if (documentType === "sales-invoice") {
        const page = await apiRequest(`/sales-invoices?${query}`, { schema: salesList, signal });
        return page.rows.map((row) => ({
          id: row.id,
          label: `${row.salesInvoiceNo} · ${formatDate(row.documentDate)} · ${row.customerName}`,
        }));
      }
      const page = await apiRequest(`/purchase-invoices?${query}`, { schema: purchaseList, signal });
      return page.rows.map((row) => ({
        id: row.id,
        label: `${row.supplierInvoiceNo ?? row.displayNo} · ${formatDate(row.documentDate)} · ${row.supplierName}`,
      }));
    },
  });
}

/**
 * A template at full size, with sample data or with a real invoice.
 *
 * Looking only — nothing here writes. "Open print page" goes to the page that
 * prints, with this template chosen.
 */
export function TemplatePreviewDialog({
  open,
  onClose,
  documentType,
  name,
  templateId,
  layout,
}: {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  name: string;
  /** Null for the built-in Classic, which has no id. */
  templateId: string | null;
  layout: TemplateLayout;
}) {
  const canOpenInvoices = usePermission(documentType, "view");
  const [search, setSearch] = useState("");
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const debounced = useDebouncedValue(search.trim(), 300);

  const choices = useInvoiceChoices(documentType, debounced, open && canOpenInvoices);
  const bundle = usePrintBundle(documentType, open ? invoiceId : null);
  const sample = useMemo(() => sampleDocument(documentType), [documentType]);

  const document = invoiceId && bundle.data ? bundle.data.document : sample;
  const printHref = invoiceId
    ? `/print/${documentType}/${invoiceId}${templateId ? `?template=${templateId}` : "?template=built-in"}`
    : null;

  return (
    <Modal open={open} onClose={onClose} title={`Preview · ${name}`} size="xl">
      <DocumentStyles />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {canOpenInvoices ? (
          <>
            <TextField
              label="Find an invoice to preview with"
              icon={Search}
              value={search}
              placeholder="Invoice No or party"
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-56 flex-1"
            />
            <div className="min-w-64 flex-[2]">
              <label htmlFor="preview-invoice" className="block text-xs font-medium text-slate-600">
                Preview with
              </label>
              <select
                id="preview-invoice"
                value={invoiceId ?? ""}
                onChange={(event) => setInvoiceId(event.target.value || null)}
                className="mt-1 block h-8 w-full rounded-md border-0 bg-white px-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
              >
                <option value="">Sample data</option>
                {(choices.data ?? []).map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
            {printHref && (
              <Link
                to={printHref}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
              >
                <Printer aria-hidden className="size-4" />
                Open print page
              </Link>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">Showing sample data.</p>
        )}
      </div>

      {invoiceId && bundle.isError && (
        <Alert className="mb-3">{describeLoadError(bundle.error, "that invoice")}</Alert>
      )}
      {invoiceId && bundle.isPending && (
        <p role="status" className="mb-2 text-xs text-slate-500">
          Loading the invoice…
        </p>
      )}

      <div className="overflow-x-auto rounded-lg bg-slate-100 p-4">
        <div className="mx-auto w-fit shadow-lg" aria-label="Document preview" role="region">
          <DocumentRenderer layout={layout} document={document} />
        </div>
      </div>
    </Modal>
  );
}
