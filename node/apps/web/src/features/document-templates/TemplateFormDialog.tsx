import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  DOCUMENT_TYPE_LABELS,
  TEMPLATE_PRESETS,
  TEMPLATE_PRESET_LABELS,
  presetLayout,
  type DocumentTemplate,
  type DocumentType,
  type TemplatePreset,
} from "@accountmanagement/contracts";
import { FormDialog, SelectField, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { useCreateTemplate, useUpdateTemplate } from "./api";
import { ScaledDocument } from "./render/ScaledDocument";
import { sampleDocument } from "./render/sample-document";

const PRESET_NOTES: Record<TemplatePreset, string> = {
  classic: "The old app's invoice: boxed, HSN, CGST/SGST table, bank details",
  compact: "One header row, striped lines, totals beside the bank details",
  modern: "Large company name, every line column, tax table and totals side by side",
  minimal: "Just the essentials, lots of white space",
};

/**
 * Creating a template from a starter layout, or changing a template's name and
 * company.
 *
 * The LAYOUT itself is not edited here — that is the block editor, which is the
 * next piece of work. A new template starts as an exact copy of the starter it
 * was made from.
 */
export function TemplateFormDialog({
  open,
  documentType,
  template,
  companies,
  onClose,
  onSaved,
}: {
  open: boolean;
  documentType: DocumentType;
  /** Null to create. */
  template: DocumentTemplate | null;
  companies: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onSaved?: (template: DocumentTemplate) => void;
}) {
  const isEdit = template !== null;
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [preset, setPreset] = useState<TemplatePreset>("classic");
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNameError(undefined);
    setFormError(null);
    setName(template?.name ?? "");
    setCompanyId(template?.companyId ?? "");
    setPreset("classic");
  }, [open, template]);

  const sample = useMemo(() => sampleDocument(documentType), [documentType]);
  const layouts = useMemo(
    () => Object.fromEntries(TEMPLATE_PRESETS.map((key) => [key, presetLayout(key, documentType)])),
    [documentType],
  ) as Record<TemplatePreset, ReturnType<typeof presetLayout>>;

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Template name is required");
      return;
    }
    setNameError(undefined);
    setFormError(null);
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: template.id, body: { name: trimmed, companyId: companyId || null } })
        : await create.mutateAsync({
            documentType,
            name: trimmed,
            companyId: companyId || null,
            basedOn: preset,
            layout: layouts[preset],
          });
      if (saved) onSaved?.(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        const nameIssue = error.issues?.find((issue) => issue.path === "name");
        if (nameIssue) setNameError(nameIssue.message);
        setFormError(error.message);
      } else {
        setFormError("The template could not be saved. Try again.");
      }
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={() => void submit()}
      title={isEdit ? "Template details" : `New ${DOCUMENT_TYPE_LABELS[documentType].toLowerCase()} template`}
      description={
        isEdit ? undefined : "Start from a layout below. It prints exactly as the preview shows."
      }
      formError={formError}
      pending={create.isPending || update.isPending}
      submitLabel={isEdit ? "Save" : "Create template"}
      size={isEdit ? "md" : "xl"}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Template name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={nameError}
          maxLength={100}
          required
        />
        <SelectField
          label="Company"
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          hint="A company's own default is used before an all-companies default."
          options={[{ value: "", label: "All companies" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      {!isEdit && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-slate-600">Starting layout</legend>
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
            {TEMPLATE_PRESETS.map((key) => (
              <label
                key={key}
                className={clsx(
                  "cursor-pointer rounded-lg border p-2 transition-colors",
                  preset === key
                    ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <input
                  type="radio"
                  name="starting-layout"
                  value={key}
                  checked={preset === key}
                  onChange={() => setPreset(key)}
                  className="sr-only"
                />
                <ScaledDocument
                  layout={layouts[key]}
                  document={sample}
                  crop={1}
                  className="rounded-sm bg-white ring-1 ring-slate-200"
                />
                <span className="mt-2 block text-sm font-medium text-slate-900">{TEMPLATE_PRESET_LABELS[key]}</span>
                <span className="block text-[11px] leading-4 text-slate-500">{PRESET_NOTES[key]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </FormDialog>
  );
}
