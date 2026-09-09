import { useState } from "react";
import clsx from "clsx";
import {
  TERMS_TEMPLATES,
  type TermsTemplateKey,
} from "@accountmanagement/contracts";
import { RichTextField } from "../../components/ui/RichTextField";
import { ConfirmDialog } from "../../components/ui";

/**
 * The purchase order's terms and conditions, and the three templates behind
 * them.
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
 */
export function TermsField({
  value,
  template,
  onChange,
  error,
}: {
  value: string;
  template: TermsTemplateKey | null;
  onChange: (next: { terms: string; termsTemplate: TermsTemplateKey | null }) => void;
  error?: string;
}) {
  const [confirming, setConfirming] = useState<TermsTemplateKey | null>(null);

  const apply = (key: TermsTemplateKey) => {
    const chosen = TERMS_TEMPLATES.find((entry) => entry.key === key);
    if (chosen) {
      onChange({ terms: chosen.html, termsTemplate: chosen.key });
    }
    setConfirming(null);
  };

  const choose = (key: TermsTemplateKey) => {
    if (key === template) return;

    /**
     * Ask before overwriting, but only when there is something to lose.
     *
     * "Something to lose" is text that is not itself a template: loading
     * Template 2 over an untouched Template 1 is the ordinary way somebody picks
     * between them, and a confirmation there is friction on the common path.
     */
    const untouched =
      value.trim() === "" || TERMS_TEMPLATES.some((entry) => entry.html === value);

    if (untouched) {
      apply(key);
    } else {
      setConfirming(key);
    }
  };

  return (
    <>
      <RichTextField
        label="Terms and conditions"
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
          const stillTheTemplate = TERMS_TEMPLATES.some((entry) => entry.html === terms);
          onChange({ terms, termsTemplate: stillTheTemplate ? template : null });
        }}
        error={error}
        placeholder="Type the terms, or load one of the templates"
        toolbarExtra={
          <div className="flex items-center gap-0.5">
            {TERMS_TEMPLATES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry.key)}
                aria-pressed={template === entry.key}
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500",
                  template === entry.key
                    ? "bg-brand-600 text-white"
                    : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800",
                )}
              >
                {entry.label}
              </button>
            ))}
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
    </>
  );
}
