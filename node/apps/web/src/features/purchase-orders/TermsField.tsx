import { useState } from "react";
import clsx from "clsx";
import { Save, Trash2 } from "lucide-react";
import { TERMS_TEMPLATES, hasPermission, type SavedTermsTemplate } from "@accountmanagement/contracts";
import { RichTextField } from "../../components/ui/RichTextField";
import { Alert, Button, ConfirmDialog, IconButton, Modal, TextField } from "../../components/ui";
import { askConfirm } from "../../components/ui/confirm";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError } from "../../lib/api-client";
import { useDeleteTermsTemplate, useSaveTermsTemplate, useSavedTermsTemplates } from "./api";

/**
 * The purchase order's terms and conditions, and the templates behind them.
 *
 * WHAT THE LEGACY SCREEN DOES, and what is different here.
 *
 * It mounts THREE CKEditor instances behind three tabs, each pre-filled with its
 * own hard-coded boilerplate, and reads only the ACTIVE one on save
 * (`PurchaseRequestScript.js:1013-1025`). Two consequences it does not intend:
 *
 *  - Text typed into a tab that is not active when Save is pressed is discarded
 *    without a word. There is no indication that two of the three editors on
 *    screen are inert.
 *  - Reopening a saved order fills only the saved tab with the saved terms; the
 *    other two show boilerplate again, so switching tab to compare silently
 *    offers to replace the document.
 *
 * Here there is ONE editor and one set of terms. The templates are buttons that
 * load boilerplate INTO it, which is what a template is, and replacing text
 * somebody has edited asks first. Which template the terms started from is still
 * recorded, because it is the only record of what a given supplier was sent.
 *
 * SAVED TEMPLATES (client, 22 Oct 2026): beside the three, terms can be saved
 * under a name of the person's own and loaded from the "Saved templates" list.
 * An order that loads one records that template's id.
 */
interface Choice {
  key: string;
  label: string;
  html: string;
}

export function TermsField({
  value,
  template,
  onChange,
  error,
}: {
  value: string;
  /** A built-in template's key, or a saved template's id. */
  template: string | null;
  onChange: (next: { terms: string; termsTemplate: string | null }) => void;
  error?: string;
}) {
  const { user } = useAuth();
  const granted = user?.permissions ?? [];
  const canSave = hasPermission(granted, "purchase-orders", "add");
  const canDelete = hasPermission(granted, "purchase-orders", "delete");
  const saved = useSavedTermsTemplates();
  const savedRows = saved.data?.rows ?? [];

  const choices: Choice[] = [
    ...TERMS_TEMPLATES.map((entry) => ({ key: entry.key, label: entry.label, html: entry.html })),
    ...savedRows.map((row) => ({ key: row.id, label: row.name, html: row.html })),
  ];

  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [managing, setManaging] = useState(false);

  const apply = (choice: Choice) => {
    onChange({ terms: choice.html, termsTemplate: choice.key });
    setConfirming(null);
  };

  const choose = (key: string) => {
    if (key === template) return;
    const choice = choices.find((entry) => entry.key === key);
    if (!choice) return;

    /**
     * Ask before overwriting, but only when there is something to lose.
     *
     * "Something to lose" is text that is not itself a template: loading
     * Template 2 over an untouched Template 1 is the ordinary way somebody picks
     * between them, and a confirmation there is friction on the common path.
     */
    const untouched = value.trim() === "" || choices.some((entry) => entry.html === value);

    if (untouched) {
      apply(choice);
    } else {
      setConfirming(choice);
    }
  };

  const savedChosen = savedRows.find((row) => row.id === template) ?? null;

  return (
    <>
      <RichTextField
        label="Terms and conditions"
        labelHidden
        value={value}
        onChange={(terms) => {
          /**
           * EDITING CLEARS THE TEMPLATE RECORD, once the text stops being the
           * template.
           *
           * Otherwise an order says it was sent Template 1 while carrying terms
           * that no longer resemble it, which is worse than saying nothing —
           * the column exists so that somebody can ask which boilerplate a
           * supplier agreed to.
           */
          const stillTheTemplate = choices.some((entry) => entry.key === template && entry.html === terms);
          onChange({ terms, termsTemplate: stillTheTemplate ? template : null });
        }}
        error={error}
        placeholder="Type the terms, or load one of the templates"
        rows={5}
        toolbarExtra={
          <div className="flex flex-wrap items-center gap-0.5">
            {TERMS_TEMPLATES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry.key)}
                aria-pressed={template === entry.key}
                className={clsx(
                  "rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500",
                  template === entry.key
                    ? "bg-brand-600 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                )}
              >
                {entry.label}
              </button>
            ))}
            {savedRows.length > 0 && (
              <select
                aria-label="Saved templates"
                value={savedChosen ? savedChosen.id : ""}
                onChange={(event) => {
                  if (event.target.value) choose(event.target.value);
                }}
                className={clsx(
                  "ml-1 h-6 max-w-44 rounded border-0 py-0 pl-1.5 pr-6 text-xs font-medium ring-1 ring-inset focus:outline-none focus:ring-2 focus:ring-brand-500",
                  savedChosen ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-300",
                )}
              >
                <option value="" disabled>
                  Saved templates…
                </option>
                {savedRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            )}
            {(canSave || (canDelete && savedRows.length > 0)) && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setManaging(true)}
                className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-600 hover:text-white"
              >
                <Save aria-hidden className="size-3.5" />
                {canSave ? "Save as template" : "Manage templates"}
              </button>
            )}
          </div>
        }
      />

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && apply(confirming)}
        title="Replace the terms?"
        body="Loading this template will replace the terms you have written. There is no undo."
        confirmLabel="Replace"
      />

      <SavedTemplatesDialog
        open={managing}
        onClose={() => setManaging(false)}
        terms={value}
        current={savedChosen}
        rows={savedRows}
        canSave={canSave}
        canDelete={canDelete}
        onSaved={(row) => onChange({ terms: row.html, termsTemplate: row.id })}
        onDeleted={(id) => {
          if (id === template) onChange({ terms: value, termsTemplate: null });
        }}
      />
    </>
  );
}

/**
 * Save the terms on the order under a name, and delete saved ones.
 *
 * Saving under a name that is already taken replaces that template's text,
 * after asking — the way a person updates "Steel supply" once its terms change.
 */
function SavedTemplatesDialog({
  open,
  onClose,
  terms,
  current,
  rows,
  canSave,
  canDelete,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  terms: string;
  current: SavedTermsTemplate | null;
  rows: SavedTermsTemplate[];
  canSave: boolean;
  canDelete: boolean;
  onSaved: (row: SavedTermsTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const save = useSaveTermsTemplate();
  const remove = useDeleteTermsTemplate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  // Fresh each time it opens: the template the order is on, or a blank name.
  if (open && !opened) {
    setOpened(true);
    setName(current?.name ?? "");
    setError(null);
  } else if (!open && opened) {
    setOpened(false);
  }

  const empty = terms.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";

  const submit = async () => {
    setError(null);
    const wanted = name.trim().replace(/\s+/g, " ");
    if (!wanted) {
      setError("Give the template a name.");
      return;
    }
    if (empty) {
      setError("Type the terms first, then save them as a template.");
      return;
    }
    const same = rows.find((row) => row.name.toLowerCase() === wanted.toLowerCase());
    if (same) {
      const yes = await askConfirm({
        title: `Replace "${same.name}"?`,
        body: "A template with this name is already saved. Its text will be replaced by the terms on this order.",
        confirmLabel: "Replace",
      });
      if (!yes) return;
    }
    try {
      const row = await save.mutateAsync({ id: same?.id, body: { name: wanted, html: terms } });
      onSaved(row);
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The template could not be saved.");
    }
  };

  const drop = async (row: SavedTermsTemplate) => {
    const yes = await askConfirm({
      title: `Delete the template "${row.name}"?`,
      body: "Orders that already use its terms keep them. Only the saved template goes.",
    });
    if (!yes) return;
    setError(null);
    try {
      await remove.mutateAsync(row.id);
      onDeleted(row.id);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The template could not be deleted.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={canSave ? "Save terms as a template" : "Saved templates"}
      description={canSave ? "Saved under a name, to load into any purchase order later" : undefined}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Close
          </Button>
          {canSave && (
            <Button type="button" icon={Save} loading={save.isPending} onClick={() => void submit()}>
              Save template
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {canSave && (
          <TextField
            label="Template name"
            required
            maxLength={80}
            value={name}
            placeholder="e.g. Steel supply, RMC, Electrical"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            hint={empty ? "The terms box on the order is empty." : "The terms now on the order are saved under this name."}
          />
        )}
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Saved templates</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">None saved yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-800">{row.name}</span>
                  {canDelete && (
                    <IconButton
                      label={`Delete template ${row.name}`}
                      icon={Trash2}
                      tone="destructive"
                      size="sm"
                      onClick={() => void drop(row)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
