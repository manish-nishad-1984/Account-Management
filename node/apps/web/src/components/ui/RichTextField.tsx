import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { Bold, Italic, List, ListOrdered, RemoveFormatting, Underline } from "lucide-react";
import { LABEL_BASE, MESSAGE_BASE, ringFor } from "./fields";

/**
 * A small rich text editor, for the one field in this application that holds
 * formatted text: a purchase order's terms and conditions.
 *
 * WHY THIS AND NOT A LIBRARY
 *
 * `05-legacy-screens` calls the legacy CKEditor "a dependency nobody has
 * budgeted for", and that is still true — TipTap or Quill is 200 kB and a
 * ProseMirror or Parchment document model in a bundle that currently has no
 * editor at all. The legacy toolbar offers images, tables, embeds and
 * blockquotes; what the three stored templates actually contain is a heading and
 * a numbered list of clauses.
 *
 * So this offers exactly the commands whose output survives the server's
 * sanitiser, and nothing else. That correspondence is the point rather than a
 * coincidence: an editor that can produce markup the server strips teaches users
 * that saving loses their formatting, and they cannot tell a security control
 * from a bug.
 *
 * WHY `document.execCommand`, WHICH IS DEPRECATED
 *
 * It is deprecated and it is implemented everywhere, and the alternative for six
 * commands is hand-written Selection and Range manipulation — splitting text
 * nodes, merging adjacent formatting, rebuilding list structure on outdent. That
 * is the part of an editor library that is genuinely hard, and writing a worse
 * version of it to avoid a deprecation notice would be the wrong trade.
 *
 * The replacement standard, `contenteditable=plaintext-only` plus a custom
 * command layer, does not cover lists at all.
 *
 * WHAT THIS MEANS FOR TESTS. jsdom does not implement `execCommand` — it is not
 * merely a no-op, the method is absent — so the toolbar cannot be exercised in a
 * unit test without a stub, and the tests below it assert on what this component
 * DOES with the command rather than on the browser's editing behaviour. The
 * formatting itself is verified in a real browser. That division is stated so
 * nobody reads the green suite as covering more than it does.
 */

interface Command {
  id: string;
  label: string;
  /** The `execCommand` name. */
  command: string;
  icon: typeof Bold;
}

/**
 * Six commands, and each maps to tags on `TERMS_ALLOWED_TAGS`.
 *
 * No link button: a purchase order is printed at least as often as it is read on
 * screen, and a URL that is only reachable by clicking is invisible on paper.
 * The sanitiser still ACCEPTS links, so terms imported from the legacy editor
 * keep theirs — this is a choice about what to offer, not about what to store.
 */
const COMMANDS: readonly Command[] = [
  { id: "bold", label: "Bold", command: "bold", icon: Bold },
  { id: "italic", label: "Italic", command: "italic", icon: Italic },
  { id: "underline", label: "Underline", command: "underline", icon: Underline },
  { id: "bullets", label: "Bulleted list", command: "insertUnorderedList", icon: List },
  { id: "numbers", label: "Numbered list", command: "insertOrderedList", icon: ListOrdered },
  { id: "clear", label: "Clear formatting", command: "removeFormat", icon: RemoveFormatting },
];

export function RichTextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  toolbarExtra,
  rows = 8,
}: {
  label: string;
  /** HTML. Empty string for an empty document. */
  value: string;
  onChange: (html: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  /** The template tabs sit in the toolbar, beside the formatting buttons. */
  toolbarExtra?: ReactNode;
  rows?: number;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const fieldId = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  /**
   * WRITE THE DOM ONLY WHEN THE VALUE CAME FROM SOMEWHERE ELSE.
   *
   * A `contenteditable` cannot be a controlled React input. Re-rendering it with
   * the value the user is currently typing replaces the child nodes, and the
   * caret goes to the start of the element on every keystroke — so text arrives
   * backwards, one character at a time, which is the single most common defect
   * in a hand-built editor.
   *
   * Comparing against `innerHTML` first means a keystroke's own round trip is a
   * no-op and only an EXTERNAL change — picking a template, opening a different
   * order, a reset after save — actually rewrites the document.
   */
  useEffect(() => {
    const element = editor.current;
    if (element && element.innerHTML !== value) {
      element.innerHTML = value;
    }
  }, [value]);

  const run = (command: string) => {
    // Focus first: `execCommand` acts on the document's selection, and a click
    // on a toolbar button has already moved focus off the editor by the time the
    // handler runs, so without this the command applies to nothing.
    editor.current?.focus();

    // Absent in jsdom, and absent behind some content policies. A missing editing
    // command must not take the whole form down with it.
    document.execCommand?.(command, false);

    if (editor.current) {
      onChange(editor.current.innerHTML);
    }
  };

  return (
    <div>
      <span className={LABEL_BASE} id={`${fieldId}-label`}>
        {label}
      </span>

      <div
        className={clsx(
          "mt-1 overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-inset",
          ringFor(error),
        )}
      >
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50/70 px-1.5 py-1">
          {COMMANDS.map(({ id, label: title, command, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={title}
              aria-label={title}
              // `onMouseDown` with `preventDefault`, NOT `onClick`. A mousedown
              // on a button blurs the editor and collapses the selection before
              // the click fires, so a click-driven Bold has nothing to embolden.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(command)}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
            >
              <Icon aria-hidden className="size-3.5" />
            </button>
          ))}

          {toolbarExtra && (
            <>
              <span aria-hidden className="mx-1 h-4 w-px bg-slate-300" />
              {toolbarExtra}
            </>
          )}
        </div>

        <div
          ref={editor}
          id={fieldId}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={(event) => onChange(event.currentTarget.innerHTML)}
          /**
           * Paste as PLAIN TEXT.
           *
           * A paste from a browser or a word processor carries its own styles,
           * classes and often a whole table of layout markup. The sanitiser
           * would strip nearly all of it on save, so the user would watch the
           * pasted block change shape after the fact. Taking the text at the
           * moment of paste is the same result, visible immediately.
           */
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            document.execCommand?.("insertText", false, text);
            onChange(event.currentTarget.innerHTML);
          }}
          className={clsx(
            "prose-terms overflow-y-auto px-2.5 py-2 text-sm text-slate-900 outline-none",
            "focus:ring-0",
          )}
          style={{ minHeight: `${rows * 1.35}rem`, maxHeight: "18rem" }}
        />
      </div>

      {error ? (
        <p id={`${fieldId}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className={clsx(MESSAGE_BASE, "text-slate-500")}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
