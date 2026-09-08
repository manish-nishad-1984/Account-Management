import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";

/**
 * A record docked beside the list, the way the legacy screens work.
 *
 * NOT A MODAL, AND THE DIFFERENCES ARE THE ENTIRE POINT:
 *
 *  - no backdrop, so the list behind stays visible and clickable;
 *  - no focus trap, so Tab leaves the panel and returns to the list;
 *  - no `aria-modal` and no `dialog` role — the rest of the page is NOT inert,
 *    and claiming otherwise to a screen reader would be a lie that costs a blind
 *    user the whole benefit of the layout;
 *  - a labelled `region` landmark, NOT `complementary`. The navigation sidebar
 *    is an `<aside>`, which already maps to `complementary`, so using it here
 *    put two identically-roled landmarks in the page. Found by driving the real
 *    browser, where the query for one matched both;
 *  - `document.body.style.overflow` is left alone, so the page still scrolls.
 *
 * Escape still closes it, because that costs nothing and is what everyone tries.
 *
 * A modal that merely looked docked would be the worst of both: it would still
 * block the list while appearing not to. Every one of the behaviours above is
 * something `Modal` deliberately does and this deliberately does not.
 */
export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: SidePanelProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only when the focus is inside the panel. Escape while the user is in the
      // list belongs to the list — closing the panel from there would discard an
      // edit they had not touched for ten minutes.
      if (panel.current?.contains(document.activeElement)) {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <section
      ref={panel}
      // A <section> with an accessible name IS a `region` landmark. Spelling the
      // role out would be redundant; the label is what does the work.
      aria-labelledby={titleId}
      className={clsx(
        "fixed inset-y-0 right-0 z-30 flex w-full flex-col bg-white shadow-2xl",
        "ring-1 ring-slate-900/5 sm:w-[28rem]",
        // Below the sticky header on large screens, so the site scope and the
        // layout switch stay reachable while a record is open.
        "lg:top-16",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="heading truncate text-base">
            {title}
          </h2>
          {description && <p className="mt-0.5 truncate text-sm text-slate-500">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <div className="scroll-subtle flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 bg-slate-50/60 px-5 py-3">
          {footer}
        </div>
      )}
    </section>,
    document.body,
  );
}
