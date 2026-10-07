import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { RecordSurfaceContext } from "./record-surface";
import { Tooltip } from "./icon-button";

/**
 * A record that has taken over the content area, with a back arrow to the list.
 *
 * NOT A DIALOG AND NOT A PANEL — it is the page. The list is not underneath it,
 * behind a backdrop, or beside it; the shell has hidden it. Everything here
 * follows from that:
 *
 *  - no backdrop, no focus trap, no `aria-modal` and no `dialog` role. There is
 *    nothing to be modal over. Claiming otherwise would tell a screen reader the
 *    rest of the page is inert when the rest of the page is the navigation rail,
 *    which is still there and still usable;
 *  - a labelled `region` landmark, like `SidePanel` and for the same reason: the
 *    sidebar is an `<aside>` and already owns `complementary`, so a second
 *    identically-roled landmark would make the query for one match both;
 *  - `document.body.style.overflow` is left alone. The content area scrolls, as
 *    it does on every other screen.
 *
 * ESCAPE DOES NOT CLOSE IT, which is the one place it parts company with the
 * other two. Escape dismisses a thing that is covering something else, and this
 * is not covering anything — on a full page it would read as "discard this form
 * and navigate away", triggered by the key people hit to close a dropdown. The
 * back arrow and Cancel are both plainly visible here, which is the whole
 * argument for the layout; neither needs a keyboard shortcut that can lose work.
 */
export interface RecordPageProps {
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function RecordPage({
  onClose,
  title,
  description,
  children,
  footer,
}: RecordPageProps) {
  const titleId = useId();
  const heading = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    /*
     * Focus lands on the HEADING, not on the first field.
     *
     * This is a view change, not a dialog opening: a screen reader that is left
     * where it was announces nothing, and the user is told only that the row
     * they clicked has disappeared. Moving focus here reads the record's name
     * out, which is the one thing they need to know. `Modal` focuses a control
     * because it is a dialog and the rest of the page is inert; that argument
     * does not carry over.
     */
    heading.current?.focus();

    return () => {
      const trigger = previouslyFocused.current;
      /*
       * Restoring on the NEXT frame, because on this one the list is still
       * hidden.
       *
       * The shell hides the routed page from `pageOpen`, which this component's
       * own unmount clears — so at the moment the cleanup runs, the row that was
       * clicked is still inside a `display: none` subtree, and `.focus()` on an
       * element with no layout box does nothing at all. One frame later it is
       * back on screen and the focus lands.
       */
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);

  return (
    <section
      // A <section> with an accessible name IS a `region` landmark. Spelling the
      // role out would be redundant; the label is what does the work.
      aria-labelledby={titleId}
      className="flex min-h-full flex-1 flex-col"
    >
      {/*
        Sticky, so the way out stays on screen.

        A record page is as tall as its form, and the forms that justify this
        layout are the tall ones. A back arrow that scrolls away leaves a user
        halfway down a purchase order with no visible way back to the list —
        which is the failure that makes people distrust drill-down navigation.
        `top-0` sticks to the content area, whose own scrolling this rides on.

        OPAQUE, and pulled out over the content area's padding on all three
        sides, because the form passes UNDERNEATH it and every gap left is a
        place fields show through.

        At 95% with a blur — what the shell's own header uses over a page
        background — the fields sliding under stayed legible through the title,
        so the bar read as a smudge rather than a surface. Opaque `slate-50` is
        the content area's own colour: it hides what is behind it while looking
        like nothing at all.

        COMPACT (client request, 5 Oct 2026: the bar was 74px, then 53, and still too
        tall for a title and one arrow). A 28px arrow with 6px above and below makes
        it 41px with its border. The `-mt-6` is what pulls it to the window edge;
        the title now sits 6px below that edge rather than 24, which is the saving.
        Anything that sticks BELOW this bar has to know the number: see the payout
        form.

        `-top-6` WITH `-mt-6`, and that pair is not decoration. A sticky
        offset resolves against the scroll container's CONTENT box, not its
        padding box, so a plain `top-0` stuck the bar 24px BELOW the header and
        left a strip of the form scrolling through the gap. Measured, not
        reasoned about: `main` is at y=64, its padding-top is 24px, and the bar
        was landing at y=88 with a field label painted at y=86. The negative
        margin and offset put its edge back on the header.
      */}
      <div className="sticky -top-6 z-10 -mx-4 -mt-6 mb-2 flex items-center gap-2.5 border-b border-slate-200 bg-app px-4 pb-1.5 pt-1.5 lg:-mx-8 lg:px-8">
        <Tooltip label="Back to list">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to list"
          /*
           * A 36px box on the page's own surface: white, hairline ring, sky on
           * hover. It is the only way back on the screen, so it has to read as a
           * control rather than as a glyph - which the bare 40px version did not,
           * sitting unringed on the same grey as the bar around it.
           */
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
        </button>
        </Tooltip>

        <div
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none"
        >
          <h1 id={titleId} title={description} className="heading truncate text-base leading-6">
            {title}
          </h1>
          {/*
            Read out, not drawn: a sentence under every title cost a line on every
            form (client request, 5 Oct 2026). It is still the heading's tooltip.
          */}
          {description && <p className="sr-only">{description}</p>}
        </div>

        {/*
          THE ACTIONS ARE IN THE TITLE BAR, at its right-hand end (client request,
          7 Oct 2026). They were a bar pinned to the bottom of the window; the
          client wants Save, Cancel and the rest where the title is, so they are
          always at the top, beside the name of what is being saved.

          The buttons are forced to 28px, the height of the back arrow, so the bar
          stays 41px: the payout form sticks its own rows beneath this bar and
          needs that number to hold. They submit through the `form` attribute, so
          living outside the form element changes nothing.
        */}
        {footer && (
          <div className="ml-auto flex shrink-0 items-center gap-2 [&_button]:h-7! [&_button]:text-xs!">
            {footer}
          </div>
        )}
      </div>

      {/*
        THE WHOLE CONTENT AREA, because room is the entire reason this layout
        exists. A record page that kept the dialog's 48rem would be a dialog with
        the backdrop removed and the list thrown away — all of the cost and none
        of the benefit.

        This was capped at `max-w-2xl` for the common form, and on a 1920px
        screen that put every field in the left third with two feet of empty desk
        beside it. What makes the width usable is not the cap but the COLUMNS:
        `FormSection` measures this container and lays its fields out two, three
        or four across to fit it, so the space is filled with fields rather than
        with one stretched column. See `record-surface.ts`.

        `max-w-[1800px]` is the one concession, and it only bites above about a
        2100px window: past that, four columns of form fields start to read as
        four separate forms.
      */}
      <RecordSurfaceContext.Provider value={true}>
        <div className="w-full max-w-[1800px] flex-1">
          {/*
            NOT wrapped in a card here. Each `FormSection` becomes its own card
            on a wide surface, which is what keeps a 1600px form readable — one
            white sheet that size, with sections divided by hairlines, reads as a
            wall rather than as a document.
          */}
          {children}
        </div>
      </RecordSurfaceContext.Provider>

    </section>
  );
}
