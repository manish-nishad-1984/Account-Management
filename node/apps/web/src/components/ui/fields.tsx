import clsx from "clsx";
import { forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { useWideSurface } from "./record-surface";

/**
 * The form controls the master screens need beyond `TextField`.
 *
 * All hand-built: the stack is Tailwind rather than a component library, so
 * there is no `<Select>` or `<MultiSelect>` to reach for. Each one carries the
 * same label / error / hint contract as `TextField`, and each wires
 * `aria-invalid` and `aria-describedby` so a screen reader gets the validation
 * message rather than only a red ring.
 */

/**
 * THE DENSITY SCALE, shared from here rather than repeated per control.
 *
 * Every control on every form is 36px tall and its text is 13px. These are data
 * entry screens for people who key documents all day: the purchase order form
 * alone carries 22 fields, a line grid and two address panels, and at the 40px
 * this started from it did not fit on a laptop screen at any dialog size, so
 * most of the work of filling it in was scrolling.
 *
 * It spent a while at 32px, which went too far the other way: a 32px box with
 * 14px text leaves 6px of air above the glyphs and reads as cramped rather than
 * as dense. 36px is the approved figure, and it is the one that still holds a
 * 24px touch target inside a 44px row once the label and gap are counted.
 *
 * Shared because three controls that are each "about the same height" is
 * precisely how a form comes to look hand-assembled. `TextField` lives in
 * `index.tsx` for historical reasons and imports these, so the input beside a
 * select is the same input.
 *
 * NO `shadow-sm`. A 1px ring and a drop shadow on the same 36px box is two
 * borders, and on a page carrying forty of them it reads as embossed. The ring
 * alone is the whole edge.
 *
 * `focus:outline-none` IS SAFE HERE AND ONLY HERE, because the line beside it
 * replaces what it removes. Chrome draws its own near-black ring on top of the
 * sky one, so a focused field had two rings in two colours — seen in a
 * screenshot of the site form, where the focused box read as bordered in black.
 * Suppressing the browser's is only acceptable while `focus:ring-2` is there to
 * take its place; the two must be changed together.
 */
export const CONTROL_BASE =
  "block w-full rounded-md border-0 py-2 text-sm leading-5 text-slate-900 " +
  "ring-1 ring-inset transition-shadow placeholder:text-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500";

/**
 * The same control inside a table cell: 32px, because a line grid puts eight of
 * them on a row and the row is the thing being kept short.
 *
 * It is the ONLY sanctioned way to be shorter than the scale. A grid that
 * invents its own `py-1` is how two line grids come to sit 2px apart.
 */
export const CONTROL_COMPACT =
  "block w-full rounded-md border-0 py-1.5 text-sm leading-5 text-slate-900 " +
  "ring-1 ring-inset transition-shadow placeholder:text-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500";

/** Above a control. 12px, so the label does not compete with the value. */
export const LABEL_BASE = "block text-xs font-medium text-slate-600";

/**
 * A screen's filter bar: every control and both buttons on ONE line (client
 * request, 16 Sep 2026).
 *
 * It is here rather than on a screen for the reason at the top of `index.tsx` —
 * the two filter bars in the application must not drift apart, and they were
 * already half a decision apart when this was written: the inward challans put
 * Search and Reset on a second row spanning the whole grid, and the reports put
 * them in a sixth equal column.
 *
 * `repeat(5,minmax(0,1fr))_auto`, not `grid-cols-6`. A sixth equal column is the
 * width of a date field, and "Search" beside "Reset" does not fit in one: at
 * 1024px that is ~175px of buttons in a ~131px cell, spilling over the edge of
 * the row. `auto` measures the buttons; the five fields divide what is left.
 *
 * `minmax(0,1fr)` and not a plain `1fr`, because a grid item's default
 * `min-width` is `auto` — a column refuses to shrink below its content, and one
 * long supplier name in a select would push the row wider than the page. That
 * bug has been paid for once already, in `FormSection`.
 *
 * `items-end` aligns the CONTROLS, not the labels. "Supplier" is one line and a
 * wrapped label is two; without this the inputs beneath them sit at different
 * heights, which is what makes a filter row look untidy even when every control
 * in it is the same size.
 *
 * Below `lg` it falls back to two columns and the buttons take a row of their
 * own: five filters on one line needs the width, and a phone does not have it.
 */
export const FILTER_ROW =
  "grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]";

/** The cell the Search/Reset pair sits in, at every width. */
export const FILTER_ACTIONS = "flex items-end gap-2 sm:col-span-2 lg:col-span-1";

/** Below one, and only ever one of error or hint is rendered. */
export const MESSAGE_BASE = "mt-1 text-xs leading-4";

export const ringFor = (error?: string) =>
  error ? "ring-rose-400 focus:ring-rose-500" : "ring-slate-300";

function FieldShell({
  id,
  label,
  labelHidden,
  error,
  hint,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  /** See the note on TextField: visually hidden, still announced. */
  labelHidden?: boolean;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelHidden ? "sr-only" : LABEL_BASE}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-rose-500">
            *
          </span>
        )}
      </label>
      <div className={labelHidden ? undefined : "mt-1"}>{children}</div>
      {error ? (
        <p id={`${id}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={clsx(MESSAGE_BASE, "text-slate-500")}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const idFor = (label: string) => `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    /** See the note on TextField: visually hidden, still announced. */
    labelHidden?: boolean;
    error?: string;
    hint?: string;
    /** Rendered as the first option, disabled — the "nothing chosen yet" state. */
    placeholder?: string;
    options: readonly { value: string | number; label: string }[];
  }
>(function SelectField(
  { label, labelHidden, error, hint, placeholder, options, id, className, required, title, ...rest },
  ref,
) {
  const fieldId = id ?? idFor(label);
  return (
    <FieldShell
      id={fieldId}
      label={label}
      labelHidden={labelHidden}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={clsx(CONTROL_BASE, ringFor(error), "px-2.5 pr-8")}
        // With its label hidden, a select still names itself on hover.
        title={title ?? (labelHidden ? label : undefined)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label: string;
    /**
     * See the note on TextField: visually hidden, still announced.
     *
     * Added for the sections whose heading already IS the label - a site's
     * address card is titled "Site address" and captioned "Main address of the
     * site", so a third line saying "Address" above the box is the same word a
     * third time. `FieldShell` has always supported it; only this control
     * refused to pass it through.
     */
    labelHidden?: boolean;
    error?: string;
    hint?: string;
  }
>(function TextAreaField(
  { label, labelHidden, error, hint, id, className, required, ...rest },
  ref,
) {
  const fieldId = id ?? idFor(label);
  return (
    <FieldShell
      id={fieldId}
      label={label}
      labelHidden={labelHidden}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <textarea
        ref={ref}
        id={fieldId}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={clsx(CONTROL_BASE, ringFor(error), "px-2.5")}
        {...rest}
      />
    </FieldShell>
  );
});

/**
 * A checkbox with its label to the right, as a switch-like row.
 *
 * `type="checkbox"` rather than a styled `<div role="switch">`, so it submits,
 * responds to Space, and is announced correctly with no extra work.
 */
export const CheckboxField = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
    label: string;
    hint?: string;
    error?: string;
  }
>(function CheckboxField({ label, hint, error, id, className, ...rest }, ref) {
  const fieldId = id ?? idFor(label);
  return (
    <div className={className}>
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 shadow-sm focus:ring-2 focus:ring-brand-500 focus:ring-offset-0"
          {...rest}
        />
        <label htmlFor={fieldId} className="text-xs font-medium text-slate-700">
          {label}
          {hint && (
            <span id={`${fieldId}-hint`} className="mt-0.5 block text-xs font-normal text-slate-500">
              {hint}
            </span>
          )}
        </label>
      </div>
      {error && (
        <p id={`${fieldId}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      )}
    </div>
  );
});

/**
 * A checkbox list for assigning many records — the sites and companies a user
 * may act on.
 *
 * This replaces the CSV string the .NET app keeps in `User.SiteId`, parsed at
 * every call site; the value here is an array of ids that becomes junction rows.
 * It is a scrolling list of real checkboxes rather than a custom listbox because
 * the counts involved (tens of sites) do not justify a virtualised widget, and
 * checkboxes are already keyboard- and screen-reader-correct.
 */
export function MultiSelectField({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  emptyMessage = "Nothing to choose from",
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  error?: string;
  hint?: string;
  emptyMessage?: string;
}) {
  const groupId = idFor(label);
  const selected = new Set(value);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange([...next]);
  };

  return (
    <fieldset aria-describedby={error ? `${groupId}-error` : undefined}>
      <legend className={LABEL_BASE}>
        {label}
        <span className="ml-1.5 text-xs font-normal text-slate-500">
          {selected.size} selected
        </span>
      </legend>

      <div
        className={clsx(
          "mt-1 max-h-40 overflow-y-auto rounded-md ring-1 ring-inset",
          error ? "ring-rose-400" : "ring-slate-300",
        )}
      >
        {options.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-slate-500">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {options.map((option) => {
              const isSelected = selected.has(option.value);
              return (
                <li key={option.value}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm transition-colors hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(option.value)}
                      className="size-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0"
                    />
                    <span className={clsx(isSelected ? "text-slate-900" : "text-slate-600")}>
                      {option.label}
                    </span>
                    {isSelected && <Check aria-hidden className="ml-auto size-3.5 text-brand-600" />}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? (
        <p id={`${groupId}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      ) : hint ? (
        <p className={clsx(MESSAGE_BASE, "text-slate-500")}>{hint}</p>
      ) : null}
    </fieldset>
  );
}

/**
 * Groups related fields inside a long form, so it reads as sections.
 *
 * `columns` DEFAULTS TO 2 AND THAT DEFAULT IS A TRAP worth knowing about: a
 * section holding a wide table and a button under it becomes two cells side by
 * side, the table squeezed into half the dialog and the button sitting where the
 * next field should be. It shipped that way on the purchase order form and was
 * reported from a screenshot, because no page test measures a width. Anything
 * that is not a row of fields wants `columns={1}`.
 *
 * `3` was added with the compact pass. Short fields — a pincode, a percentage, a
 * date — waste two thirds of a row at two columns, and the point of the exercise
 * was to stop the forms scrolling.
 */
export function FormSection({
  title,
  description,
  icon: Icon,
  action,
  className,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  /**
   * A 16px mark beside the heading, in a 28px pale-blue tile.
   *
   * SMALL ON PURPOSE, and the size is the whole point of having a prop rather
   * than letting each screen draw its own. A section icon supports the heading;
   * at the 40-50px tile this was first drawn with, the mark was the largest
   * thing in the card and "Site Contacts" read as its caption.
   */
  icon?: LucideIcon;
  /** Top-right of the section — the repeater's own "+ Add" belongs here. */
  action?: ReactNode;
  /**
   * For PLACING the section, never for styling it.
   *
   * Two sections that belong side by side — a site's address and its delivery
   * addresses, at 40/60 — need a grid span, and a span belongs to the parent's
   * layout rather than to the section. Anything that changes how the section
   * itself LOOKS belongs in here, not at a call site.
   */
  className?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  /**
   * On a full page this section becomes its own card and lays out against the
   * width it is actually given. In a dialog or a side panel it is exactly what
   * it always was. See `record-surface.ts`.
   */
  const wide = useWideSurface();

  /**
   * SENTENCE CASE, 13px, WITH THE MARK BESIDE IT — the same heading in a dialog
   * and on a page.
   *
   * This was an 11px uppercase micro-label, which is a fine way to divide a
   * narrow form and a poor way to head a card: at 1600px wide with a card border
   * around it, "SITE CONTACTS" in 11px letter-spaced caps reads as a legend
   * floating over the fields rather than as the card's title. One treatment in
   * both places, because the alternative is a product that looks like two.
   */
  const heading = (
    <div className="flex items-start gap-2.5">
      {Icon && (
        <span
          aria-hidden
          className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100"
        >
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-5 text-slate-900">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="ml-auto shrink-0 pl-2">{action}</div>}
    </div>
  );

  const grid = (
    <div
      className={clsx(
        // Row gap tighter than column gap: fields read down a column, and the
        // horizontal space is what keeps two adjacent labels from running
        // together.
        "mt-2 grid gap-x-4 gap-y-3",
        /*
         * EVERY CELL MAY SHRINK BELOW ITS CONTENT, and without this one class a
         * line grid pushes the whole page sideways.
         *
         * A grid item's `min-width` is `auto`, which means "not smaller than my
         * content". The purchase order's Products section holds a table with
         * `min-w-[52rem]` inside an `overflow-x-auto` wrapper — the wrapper is
         * supposed to absorb that, and it cannot, because the TRACK it sits in
         * has already been grown to 832px to fit it. The card grows, the page
         * grows, and the whole document scrolls sideways on a phone: 487px of
         * document in a 390px window, measured on the record page.
         *
         * Fixed here rather than on each of the five scrollers, because the next
         * wide thing somebody puts in a section would bring the bug back. The
         * class is a no-op for a field, which is already `w-full`.
         */
        "[&>*]:min-w-0",
        columns === 1 && "grid-cols-1",
        /*
         * A ONE-COLUMN SECTION ON A PAGE CAPS ITS CONTROLS, NOT ITSELF.
         *
         * Seventeen sections say `columns={1}` and they are two different
         * things. Eleven hold a line grid — the purchase order's eight columns,
         * the invoices' — and those wanting the whole 1600px is the entire
         * reason the full page exists. The other six are repeaters of short
         * fields: a site's locations, its contacts. Those stretched to 1500px
         * for the word "Block A", which looked worse than the narrow layout
         * this was meant to fix.
         *
         * Capping the SECTION would have meant picking one of those two and
         * editing seventeen call sites to correct it. Capping the controls needs
         * neither: 48rem is what a field already gets in a dialog, so it is a
         * no-op everywhere except where something was stretched — a line grid's
         * quantity box is 100px wide and never reaches it. The grid, the totals
         * row and the dropzone keep the full width.
         */
        columns === 1 &&
          wide &&
          "[&_input]:max-w-3xl [&_select]:max-w-3xl [&_textarea]:max-w-3xl",
        /*
         * CONTAINER widths on a page, VIEWPORT widths in a box.
         *
         * `@sm`/`@3xl`/`@5xl` measure this section, not the window, which is the
         * only thing that can be right in both places: the same form is 28rem
         * wide in a side panel and 1600px wide on a page, at one unchanged
         * window size. Viewport breakpoints would give the panel four columns of
         * 90px.
         *
         * TWO COLUMNS IS THE FLOOR from `@sm` (384px) up, and that is load
         * bearing rather than taste. Twenty-five fields across twelve forms say
         * `sm:col-span-2` to mean "take the whole row", and that is a VIEWPORT
         * rule this cannot see. Were this grid ever one column while the window
         * was 640px or wider, those fields would span into an implicit second
         * column and overflow their section. The narrowest container in the
         * application is the side panel at 416px of content — above the floor —
         * and everything narrower than 384px only happens below the `sm`
         * viewport, where the span does not apply. So the two rules can never
         * disagree.
         *
         * Above the floor `col-span-2` stops meaning "full width" and starts
         * meaning "double width", which is the intent either way: the fields
         * that ask for it are the long ones — an address, an item name, a
         * receiver.
         */
        columns !== 1 && !wide && "sm:grid-cols-2",
        columns === 2 && wide && "@sm:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4",
        /*
         * THREE IS A CEILING, NOT A STEP ON THE WAY TO FOUR.
         *
         * `columns={3}` says the fields in here are short and there are six of
         * them — a challan number, an LR number, a vehicle number — so they
         * should read as two rows of three whatever the card is given. The
         * two-column ladder above would make that four-and-two on a wide card,
         * which is the ragged shape the mockup of 21 Sep 2026 was correcting.
         *
         * `@lg` (512px) rather than `@3xl`, because a section asking for three
         * columns is asking for them in the HALF-width card it was put in: the
         * paired Delivery card is about 520px of content at 1536px, and at the
         * two-column ladder's `@3xl` it would never reach three at any window
         * size this application is used at.
         */
        columns === 3 && wide && "@xs:grid-cols-2 @lg:grid-cols-3",
        // Off a card the viewport decides, since there is no container to measure.
        columns === 3 && !wide && "lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  );

  if (!wide) {
    return (
      <section
        className={clsx("border-t border-slate-200 pt-3 first:border-t-0 first:pt-0", className)}
      >
        {heading}
        {grid}
      </section>
    );
  }

  /*
   * A CARD PER SECTION, and `@container` so the grid above can measure it.
   *
   * One white sheet 1600px wide, with sections divided by hairlines, reads as a
   * wall. The hairline is enough separation at 48rem and stops being enough
   * somewhere around twice that.
   */
  return (
    <section
      className={clsx(
        "@container rounded-xl border border-slate-200 bg-white p-4 shadow-card",
        className,
      )}
    >
      {heading}
      {grid}
    </section>
  );
}
