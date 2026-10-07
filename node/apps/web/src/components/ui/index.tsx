import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useCallback, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { DatePickerButton } from "./DatePicker";
import {
  CONTROL_BASE,
  CONTROL_COMPACT,
  LABEL_BASE,
  MESSAGE_BASE,
  ringFor,
} from "./fields";

// Tooltip and IconButton live in their own module so that Modal, SidePanel and
// RecordPage can use them without importing this barrel, which re-exports those
// three — a cycle a bundler resolves by handing someone an undefined binding.
// Re-exported here so screens still import every primitive from one place.
import { Tooltip } from "./icon-button";
export { Tooltip, IconButton, type IconTone } from "./icon-button";

/**
 * The shared primitives every screen is built from.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a screen does not choose a colour, a
 * radius, a control height or an icon size. It chooses a COMPONENT and a
 * VARIANT. Seventeen screens each styling their own "add" button is how an
 * application comes to look like seventeen applications, and it is not a thing
 * a review catches — each one looks fine on its own.
 */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={clsx(
        // 10px corners and a hairline: the radius comes from `--radius-xl`,
        // re-pointed in `index.css`, so every card moved together.
        "rounded-xl border border-slate-200 bg-white shadow-card",
        padded && "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span
            aria-hidden
            className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100"
          >
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="heading text-sm leading-5">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * Where a page says what it is, and the actions that belong to the whole screen.
 *
 * NO VISIBLE TITLE (client request, 18 Sep 2026). The breadcrumb in the top bar
 * already names the page, and highlights it, so a 22px title and a line of
 * explanation under it said the same thing a second time in the height the grid
 * needs. The name is still the page's `<h1>`, visually hidden, because a screen
 * reader announces a page by its heading and moves through a page by headings.
 * `description` is still accepted, so the seventeen screens that pass one need
 * no edit, and is not shown.
 *
 * What remains visible is the action bar — Add, Record, a Purchases / Sales
 * switch — on the right, and only when there is something to put in it.
 *
 * THE BREADCRUMB IS NOT HERE. `AppShell` owns it; see `Breadcrumb` there.
 */
export function PageHeader({
  title,
  actions,
  filters,
  onBack,
}: {
  title: string;
  /** Filters on the left of the action bar, on the same line as the actions. */
  filters?: ReactNode;
  /** Accepted and not shown; see above. */
  description?: string;
  actions?: ReactNode;
  /** Renders a 36px back square at the left of the action bar. */
  onBack?: () => void;
}) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {(actions || onBack || filters) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {filters ? (
            <div className="flex flex-wrap items-center gap-3">{filters}</div>
          ) : onBack ? (
            <Tooltip label="Back">
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <ArrowLeft aria-hidden className="size-4" />
              </button>
            </Tooltip>
          ) : (
            <span />
          )}
          {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        </div>
      )}
    </>
  );
}


/* ===========================================================================
   THE BUTTON SYSTEM
   ---------------------------------------------------------------------------
   Four jobs, five variants, and the hierarchy is the point: if every action on
   a screen is a filled sky button then nothing on that screen is the action.

     primary    the one thing this screen is for - Create, Save, Record
     secondary  the way out - Cancel, Back, Reset. Never red: cancelling a form
                is not destructive, and a red Cancel beside a red Delete is a
                genuine hazard
     outline    an operation WITHIN the screen - Add Contact, Upload, Import.
                Pale sky, sky border, sky icon: plainly interactive, plainly
                not the primary
     ghost      incidental - a toolbar toggle, an icon in a row
     danger     the destructive confirm, and only there

   Heights are 36px (md) and 32px (sm), never the 44-48px of a mobile-first
   component library: this is a desk application, and a 48px button beside a
   36px input looks like a mistake because it is one.
   =========================================================================== */

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 " +
    "focus-visible:outline-brand-600 disabled:bg-brand-300",
  secondary:
    "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 " +
    "hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 active:bg-brand-100 " +
    "focus-visible:outline-brand-500 disabled:text-slate-400 disabled:ring-slate-200 " +
    "disabled:hover:bg-white disabled:hover:text-slate-400",
  outline:
    "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 " +
    "hover:bg-brand-100 hover:ring-brand-300 active:bg-brand-200 " +
    "focus-visible:outline-brand-500 disabled:bg-slate-50 disabled:text-slate-400 " +
    "disabled:ring-slate-200",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 " +
    "focus-visible:outline-slate-400 disabled:text-slate-400",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 " +
    "focus-visible:outline-rose-600 disabled:bg-rose-300",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 rounded-md px-2.5 text-xs",
  md: "h-9 rounded-lg px-3 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    /** Replaces the label while loading - "Create Site" becomes "Creating...". */
    loadingLabel?: string;
    icon?: LucideIcon;
  }
>(function Button(
  {
    variant = "primary",
    size = "md",
    loading,
    loadingLabel,
    icon: Icon,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // "button" UNLESS SAID OTHERWISE. HTML's default is "submit", so every
      // Button inside a form without a type submitted it: the Add product and
      // Remove line buttons on the invoice and order forms saved the document
      // when it was valid, and jumped the cursor to the first error when it was
      // not. Found 14 Sep 2026. Submit buttons pass type="submit", and all do.
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium",
        "transition-colors duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed",
        BUTTON_SIZES[size],
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : Icon ? (
        // 14px, the approved size for an icon inside a button. The 1.5 stroke
        // is set once, for every icon - see LucideProvider in App.tsx.
        <Icon aria-hidden className="size-3.5" />
      ) : null}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
});


export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    error?: string;
    hint?: string;
    icon?: LucideIcon;
    /**
     * Hide the label visually while keeping it for assistive technology.
     *
     * For a GRID of inputs, where the column header carries the meaning on
     * screen but every cell still needs its own accessible name. The label stays
     * required - an input with no name is unusable with a screen reader, and a
     * placeholder is no substitute because it vanishes on typing.
     *
     * Labels must still be UNIQUE: id is derived from the label text, so two
     * inputs both labelled "Quantity" would share an id and the second label
     * would point at the first input. Grid callers include the row number.
     */
    labelHidden?: boolean;
    /** 32px instead of 36px, for an input inside a table cell. */
    compact?: boolean;
  }
>(function TextField(
  { label, labelHidden, error, hint, icon: Icon, compact, id, className, ...rest },
  ref,
) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  // A date field keeps its real input and gets a calendar beside it. Its own ref
  // is merged with the caller's (a form library's) so both can reach the element.
  const isDate = rest.type === "date";
  const localRef = useRef<HTMLInputElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <div className={className}>
      <label htmlFor={inputId} className={labelHidden ? "sr-only" : LABEL_BASE}>
        {label}
      </label>
      <div className={clsx("relative", !labelHidden && "mt-1")}>
        {Icon && (
          <Icon
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
          />
        )}
        <input
          ref={isDate ? setRefs : ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          // The same constants the select and the textarea use, so a row of
          // mixed controls lines up. See fields.tsx for the density scale.
          className={clsx(
            compact ? CONTROL_COMPACT : CONTROL_BASE,
            ringFor(error),
            Icon ? "pl-8 pr-2.5" : "px-2.5",
            // Room for the calendar button; the browser's own indicator is hidden in index.css.
            isDate && "pr-9",
          )}
          {...rest}
        />
        {isDate && !rest.readOnly && (
          <DatePickerButton
            inputRef={localRef}
            min={typeof rest.min === "string" ? rest.min : undefined}
            max={typeof rest.max === "string" ? rest.max : undefined}
            required={rest.required}
            disabled={rest.disabled}
            label={label}
            compact={compact}
          />
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      ) : hint ? (
        <p className={clsx(MESSAGE_BASE, "text-slate-500")}>{hint}</p>
      ) : null}
    </div>
  );
});

/* ---------------------------------------------------------------- status pills
   Compact, desaturated, and never more than one per cell. The palette these
   draw from was toned down in index.css: a grid of twelve saturated badges is
   a grid nobody can skim. */
type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const BADGE_STYLES: Record<Tone, string> = {
  neutral: "bg-slate-50 text-slate-600 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-brand-50 text-brand-700 ring-brand-200",
};

const DOT_STYLES: Record<Tone, string> = {
  neutral: "bg-slate-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-brand-500",
};

export function Badge({
  children,
  tone = "neutral",
  title,
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={clsx(
        // 22px tall: 11px text in a half-step of padding. A badge is an
        // adjective on a row, not a control, and must not set the row height.
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5",
        "text-xs font-medium leading-4 ring-1 ring-inset",
        BADGE_STYLES[tone],
      )}
    >
      {dot && <span aria-hidden className={clsx("size-1.5 rounded-full", DOT_STYLES[tone])} />}
      {children}
    </span>
  );
}

/**
 * Nothing here yet, and what to do about it.
 *
 * COMPACT. This was 96px of vertical padding around a 44px circle, which on an
 * empty Sites grid was a 200px announcement that there were no sites. An ERP
 * empty state is a routine condition - a filter that matched nothing, a new
 * company - not an occasion for an illustration.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** The one thing to do about it, per the brief: "No contacts yet. + Add". */
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-10 text-center">
      {Icon && (
        <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-slate-100">
          <Icon aria-hidden className="size-4 text-slate-400" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-slate-500">{description}</p>
      )}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * The empty state for a REPEATER inside a form, as opposed to for a whole grid.
 *
 * `EmptyState` is 40px of padding around a centred icon, which is right for an
 * empty Sites screen and far too much inside a card that is one of four on a
 * form — it made "No contacts yet." a 170px announcement, measured on the site
 * page. A dashed slot at the height of one row says the same thing and looks
 * like what it is: a place where rows go.
 *
 * It carries NO BUTTON. The section header already has "Add contact", and two
 * identical buttons six lines apart is a choice the reader has to make for no
 * reason — it also made the query for one of them ambiguous, which is the same
 * complaint in accessible form.
 */
export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

export function Alert({
  children,
  tone = "danger",
  icon: Icon,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  /** For grid placement - an Alert inside a two-column FormSection spans both. */
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        "flex items-start gap-2 rounded-md px-2.5 py-2 text-sm leading-5 ring-1 ring-inset",
        BADGE_STYLES[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

/**
 * The one spinner. Small, in place, and never a full-screen curtain: a page
 * that blanks itself to load loses the reader's place, and the thing they were
 * looking at was usually still correct.
 */
export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={clsx("inline-flex", className)}>
      <Loader2 aria-hidden className="size-4 animate-spin text-slate-400" />
    </span>
  );
}

// The dialog and form controls live in their own files - this module is already
// long - but are re-exported here so screens import from one place.
export { Modal } from "./Modal";
export { FormDialog } from "./FormDialog";
export { ConfirmDialog } from "./ConfirmDialog";
export { SummaryStrip, type SummaryItem } from "./SummaryStrip";
export {
  SelectField,
  TextAreaField,
  CheckboxField,
  MultiSelectField,
  FormSection,
  FILTER_ROW,
  FILTER_ACTIONS,
} from "./fields";
