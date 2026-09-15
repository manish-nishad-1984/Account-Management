import clsx from "clsx";
import { Copy, Eye, Pencil, Star, Trash2 } from "lucide-react";
import {
  TEMPLATE_PRESET_LABELS,
  type DocumentTemplate,
  type PrintDocument,
  type TemplateLayout,
} from "@accountmanagement/contracts";
import { ScaledDocument } from "./render/ScaledDocument";

const orientationOf = (layout: TemplateLayout) =>
  `${layout.page.size} ${layout.page.orientation}`;

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  danger,
}: {
  label: string;
  icon: typeof Copy;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={clsx(
        "rounded-md p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-amber-50 text-amber-500"
          : danger
            ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
      )}
    >
      <Icon aria-hidden className={clsx("size-4", active && "fill-amber-400")} />
    </button>
  );
}

/**
 * One template in the grid: the real page drawn small, and what can be done
 * with it.
 *
 * The hover actions are also reachable by keyboard — they show on focus inside
 * the card, not only on a mouse pointer.
 */
export function TemplateCard({
  template,
  document,
  canAdd,
  canEdit,
  canDelete,
  busy,
  onEdit,
  onPreview,
  onDuplicate,
  onMakeDefault,
  onDelete,
}: {
  template: DocumentTemplate;
  document: PrintDocument;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      aria-label={template.name}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card transition-shadow hover:shadow-md"
    >
      <div className="relative border-b border-slate-100 bg-slate-50 p-3">
        {template.isDefault && (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            Default
          </span>
        )}
        <ScaledDocument
          layout={template.layout}
          document={document}
          crop={0.72}
          className="rounded-sm bg-white shadow-sm ring-1 ring-slate-200"
        />
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/0 opacity-0 transition-all group-focus-within:bg-slate-900/25 group-focus-within:opacity-100 group-hover:bg-slate-900/25 group-hover:opacity-100">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-md hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <Pencil aria-hidden className="size-4" />
              Edit details
              <span className="sr-only"> of {template.name}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview ${template.name}`}
            title="Preview"
            className="rounded-lg bg-white p-2 text-slate-800 shadow-md hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Eye aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-3 pt-2.5">
        <h3 className="truncate text-sm font-semibold text-slate-900" title={template.name}>
          {template.name}
        </h3>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {orientationOf(template.layout)} · {TEMPLATE_PRESET_LABELS[template.basedOn]} ·{" "}
          {template.companyName ?? "All companies"}
        </p>
      </div>

      <div className="mt-2.5 flex items-center gap-0.5 border-t border-slate-100 px-2 py-1.5">
        {canAdd && (
          <IconButton label={`Duplicate ${template.name}`} icon={Copy} onClick={onDuplicate} disabled={busy} />
        )}
        {canEdit && (
          <IconButton
            label={template.isDefault ? `${template.name} is the default` : `Make ${template.name} the default`}
            icon={Star}
            active={template.isDefault}
            onClick={onMakeDefault}
            disabled={busy || template.isDefault}
          />
        )}
        <span className="flex-1" />
        {canDelete && (
          <IconButton
            label={template.isDefault ? "The default cannot be deleted" : `Delete ${template.name}`}
            icon={Trash2}
            danger
            onClick={onDelete}
            disabled={busy || template.isDefault}
          />
        )}
      </div>
    </article>
  );
}
