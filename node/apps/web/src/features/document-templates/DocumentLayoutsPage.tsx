import { useMemo, useState } from "react";
import clsx from "clsx";
import { Eye, Info, Plus } from "lucide-react";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  presetLayout,
  type DocumentTemplate,
  type DocumentType,
  type TemplateLayout,
} from "@accountmanagement/contracts";
import { Alert, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { usePermission } from "../../lib/permissions";
import { describeLoadError } from "../../lib/load-error";
import { useCompanyOptions } from "../purchase-orders/api";
import {
  useDeleteTemplate,
  useDocumentTemplates,
  useDuplicateTemplate,
  useMakeDefaultTemplate,
} from "./api";
import { TemplateCard } from "./TemplateCard";
import { TemplateFormDialog } from "./TemplateFormDialog";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";
import { DocumentStyles } from "./render/DocumentRenderer";
import { ScaledDocument } from "./render/ScaledDocument";
import { sampleDocument } from "./render/sample-document";

type Preview = { name: string; templateId: string | null; layout: TemplateLayout };

/**
 * Document Layouts — how each kind of document prints.
 *
 * A client request (14 Sep 2026), modelled on the layout screen of their billing
 * software: a tab per document type, a card per template drawn from the real
 * renderer, one default per company.
 *
 * WHICH TEMPLATE PRINTS: the default set for the invoice's own company, else
 * the all-companies default, else the built-in Classic — which is the old app's
 * printed invoice, so nothing changes for anyone until a default is chosen.
 */
export function DocumentLayoutsPage() {
  const canAdd = usePermission("document-template", "add");
  const canEdit = usePermission("document-template", "edit");
  const canDelete = usePermission("document-template", "delete");

  const [documentType, setDocumentType] = useState<DocumentType>("sales-invoice");
  const [companyFilter, setCompanyFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const templates = useDocumentTemplates(documentType);
  const companies = useCompanyOptions();
  const duplicate = useDuplicateTemplate();
  const makeDefault = useMakeDefaultTemplate();
  const remove = useDeleteTemplate();

  const companyOptions = useMemo(
    () => (companies.data?.rows ?? []).map((row) => ({ id: row.id, name: row.name })),
    [companies.data],
  );
  const sample = useMemo(() => sampleDocument(documentType), [documentType]);
  const builtIn = useMemo(() => presetLayout("classic", documentType), [documentType]);

  const rows = templates.data?.rows ?? [];
  const visible = companyFilter
    ? rows.filter((row) => row.companyId === null || row.companyId === companyFilter)
    : rows;
  const hasSharedDefault = rows.some((row) => row.isDefault && row.companyId === null);
  const busy = duplicate.isPending || makeDefault.isPending || remove.isPending;

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That did not work. Try again.");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <DocumentStyles />
      <PageHeader
        title="Document Layouts"
        description="How invoices look when they are printed or saved as PDF"
        actions={
          <>
            <label htmlFor="layout-company" className="sr-only">
              Company
            </label>
            <select
              id="layout-company"
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="h-8 rounded-md border-0 bg-white px-2.5 pr-8 text-sm text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All companies</option>
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            {canAdd && (
              <Button icon={Plus} onClick={openCreate}>
                Create template
              </Button>
            )}
          </>
        }
      />

      <div
        role="tablist"
        aria-label="Document type"
        className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-card"
      >
        {DOCUMENT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={type === documentType}
            onClick={() => {
              setDocumentType(type);
              setActionError(null);
            }}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              type === documentType ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {DOCUMENT_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <p className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        An invoice prints with its company's default, then the all-companies default, then the built-in Classic.
        Credit notes and returns use the same template, with their own title.
      </p>

      {actionError && <Alert className="mb-3">{actionError}</Alert>}

      {templates.isError ? (
        <Alert>{describeLoadError(templates.error, "the templates")}</Alert>
      ) : templates.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-slate-500">
          Loading templates…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Templates">
          {canAdd && (
            <button
              type="button"
              onClick={openCreate}
              className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 p-6 text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              <span className="flex size-11 items-center justify-center rounded-full border border-current">
                <Plus aria-hidden className="size-5" />
              </span>
              <span className="text-sm font-semibold">Create new</span>
              <span className="text-xs">Start from a ready layout</span>
            </button>
          )}

          {!hasSharedDefault && (
            <article
              aria-label="Classic (built in)"
              className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
            >
              <div className="relative border-b border-slate-100 bg-slate-50 p-3">
                <span className="absolute left-2 top-2 z-10 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Built in
                </span>
                <ScaledDocument
                  layout={builtIn}
                  document={sample}
                  crop={0.72}
                  className="rounded-sm bg-white shadow-sm ring-1 ring-slate-200"
                />
              </div>
              <div className="flex flex-1 flex-col px-3 pt-2.5">
                <h3 className="text-sm font-semibold text-slate-900">Classic (built in)</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Prints when no all-companies default is set. It cannot be changed; create a template from it instead.
                </p>
              </div>
              <div className="mt-2.5 flex items-center border-t border-slate-100 px-2 py-1.5">
                <Button
                  variant="ghost"
                  icon={Eye}
                  onClick={() => setPreview({ name: "Classic (built in)", templateId: null, layout: builtIn })}
                >
                  Preview
                </Button>
              </div>
            </article>
          )}

          {visible.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              document={sample}
              canAdd={canAdd}
              canEdit={canEdit && template.capabilities.canEdit}
              canDelete={canDelete && template.capabilities.canDelete}
              busy={busy}
              onEdit={() => {
                setEditing(template);
                setFormOpen(true);
              }}
              onPreview={() => setPreview({ name: template.name, templateId: template.id, layout: template.layout })}
              onDuplicate={() => void run(() => duplicate.mutateAsync(template.id))}
              onMakeDefault={() => void run(() => makeDefault.mutateAsync(template.id))}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(template);
              }}
            />
          ))}
        </div>
      )}

      {!templates.isPending && !templates.isError && visible.length === 0 && !canAdd && (
        <p className="mt-4 text-sm text-slate-500">No templates yet. Invoices print with the built-in Classic.</p>
      )}

      <TemplateFormDialog
        open={formOpen}
        documentType={documentType}
        template={editing}
        companies={companyOptions}
        onClose={() => setFormOpen(false)}
      />

      {preview && (
        <TemplatePreviewDialog
          open
          onClose={() => setPreview(null)}
          documentType={documentType}
          name={preview.name}
          templateId={preview.templateId}
          layout={preview.layout}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError(null);
          try {
            await remove.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          } catch (error) {
            setDeleteError(error instanceof Error ? error.message : "The template could not be deleted.");
          }
        }}
        pending={remove.isPending}
        error={deleteError}
        title="Delete template"
        body={
          <p>
            Delete <span className="font-medium text-slate-900">{deleteTarget?.name}</span>? Invoices already printed
            are not affected.
          </p>
        }
      />
    </>
  );
}
