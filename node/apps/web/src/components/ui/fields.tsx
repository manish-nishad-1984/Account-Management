import clsx from "clsx";
import { forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check } from "lucide-react";

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
 * Every control on every form is 32px tall — `py-1.5` over a 20px line box —
 * where it was 40px, and its label is 12px rather than 14px. These are data
 * entry screens for people who key documents all day: the purchase order form
 * alone carries 22 fields, a line grid and two address panels, and at the old
 * spacing it did not fit on a laptop screen at any dialog size, so most of the
 * work of filling it in was scrolling.
 *
 * Shared because three controls that are each "about the same height" is
 * precisely how a form comes to look hand-assembled. `TextField` lives in
 * `index.tsx` for historical reasons and imports these, so the input beside a
 * select is the same input.
 *
 * The 32px figure is not arbitrary either: it keeps a 24px touch target inside
 * a 44px row once the label and gap are counted, and it is what every dense
 * business grid this application is replacing already uses.
 */
export const CONTROL_BASE =
  "block w-full rounded-md border-0 py-1.5 text-sm text-slate-900 shadow-sm " +
  "ring-1 ring-inset transition-shadow placeholder:text-slate-400 " +
  "focus:ring-2 focus:ring-inset focus:ring-brand-500";

/** Above a control. 12px, so the label does not compete with the value. */
export const LABEL_BASE = "block text-xs font-medium text-slate-600";

/** Below one, and only ever one of error or hint is rendered. */
export const MESSAGE_BASE = "mt-1 text-[11px] leading-4";

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
  { label, labelHidden, error, hint, placeholder, options, id, className, required, ...rest },
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
    error?: string;
    hint?: string;
  }
>(function TextAreaField({ label, error, hint, id, className, required, ...rest }, ref) {
  const fieldId = id ?? idFor(label);
  return (
    <FieldShell
      id={fieldId}
      label={label}
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
            <span id={`${fieldId}-hint`} className="mt-0.5 block text-[11px] font-normal text-slate-500">
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
        <span className="ml-1.5 text-[11px] font-normal text-slate-500">
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
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="border-t border-slate-200/70 pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>}
      <div
        className={clsx(
          // Row gap tighter than column gap: fields read down a column, and the
          // horizontal space is what keeps two adjacent labels from running
          // together.
          "mt-2 grid gap-x-4 gap-y-3",
          columns === 1 && "grid-cols-1",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </section>
  );
}
