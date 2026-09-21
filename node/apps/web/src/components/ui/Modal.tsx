import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { IconButton } from "./icon-button";

/**
 * A modal dialog.
 *
 * Hand-built because the stack is Tailwind rather than a component library
 * (`16-Technology-Stack.md` proposed Mantine; Tailwind was chosen instead), so
 * the accessibility behaviour a library would provide has to be written out:
 *
 *  - focus moves into the dialog on open and returns to the trigger on close,
 *    so a keyboard user is not dropped at the top of the document;
 *  - Tab is trapped inside the dialog while it is open;
 *  - Escape closes it;
 *  - the backdrop closes it, but only on a click that BEGAN on the backdrop —
 *    otherwise a text selection that drags out of the dialog closes the form and
 *    discards what was typed;
 *  - `aria-labelledby` points at the title, and `role="dialog"` with
 *    `aria-modal` tells a screen reader the rest of the page is inert.
 *
 * The .NET screens use Bootstrap modals with none of this except Escape.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * `lg` for the multi-section master forms, `sm` for a confirmation, `xl` for
   * a form whose body is a data-entry GRID rather than a column of fields.
   */
  size?: "sm" | "md" | "lg" | "xl";
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdropMouseDown = useRef(false);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // The first focusable control, not the panel itself: a form should open with
    // the cursor in its first field.
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panel.current) return;

      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      // Wrap at both ends, so Tab never escapes to the page behind the dialog.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-4"
      onMouseDown={(event) => {
        backdropMouseDown.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only when the gesture STARTED on the backdrop — a selection dragged out
        // of the form must not discard it.
        if (backdropMouseDown.current && event.target === event.currentTarget) {
          onClose();
        }
        backdropMouseDown.current = false;
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "my-auto w-full rounded-xl border border-slate-200 bg-white shadow-pop outline-none",
          size === "sm" && "max-w-md",
          size === "md" && "max-w-xl",
          size === "lg" && "max-w-3xl",
          // The purchase order grid needs 52rem for its eight columns, so in a
          // 48rem `lg` it scrolls sideways — which puts the price and GST boxes
          // off screen while you are typing the line they belong to.
          size === "xl" && "max-w-5xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-2.5">
          <div className="min-w-0">
            <h2 id={titleId} className="heading text-sm leading-5">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
            )}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} className="-mr-1 shrink-0" />
        </div>

        {/*
          THE BODY TAKES EVERY ROW IT CAN, which is half of "less scroll".

          16rem of reserved chrome was roughly twice what the header, the footer
          and the backdrop padding actually occupy, so a form that fitted the
          screen scrolled anyway. Measured: 3rem of header, 3rem of footer, 3rem
          of backdrop padding top and bottom together, and 1rem of slack.
        */}
        <div className="scroll-subtle max-h-[calc(100vh-10rem)] overflow-y-auto px-4 py-3">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-surface-muted px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
