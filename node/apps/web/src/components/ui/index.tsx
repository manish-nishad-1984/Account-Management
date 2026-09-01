import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

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
        "rounded-xl border border-slate-200/80 bg-white shadow-card",
        padded && "p-5",
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
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="heading text-sm">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="heading text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 " +
    "focus-visible:outline-brand-600 disabled:bg-brand-300 disabled:shadow-none",
  secondary:
    "bg-white text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 " +
    "hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 " +
    "focus-visible:outline-slate-400 disabled:text-slate-300 disabled:shadow-none",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 " +
    "focus-visible:outline-slate-400 disabled:text-slate-300",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 " +
    "focus-visible:outline-rose-600 disabled:bg-rose-300",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    loading?: boolean;
    icon?: LucideIcon;
  }
>(function Button(
  { variant = "primary", loading, icon: Icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2",
        "text-sm font-medium transition-all duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed",
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden className="size-4" />
      ) : null}
      {children}
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
  }
>(function TextField({ label, error, hint, icon: Icon, id, className, ...rest }, ref) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative mt-1.5">
        {Icon && (
          <Icon
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={clsx(
            "block w-full rounded-lg border-0 py-2.5 text-sm text-slate-900",
            "shadow-sm ring-1 ring-inset transition-shadow placeholder:text-slate-400",
            "focus:ring-2 focus:ring-inset focus:ring-brand-500",
            Icon ? "pl-9 pr-3" : "px-3",
            error ? "ring-rose-400 focus:ring-rose-500" : "ring-slate-300",
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});

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
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
        "text-xs font-medium ring-1 ring-inset",
        BADGE_STYLES[tone],
      )}
    >
      {dot && <span aria-hidden className={clsx("size-1.5 rounded-full", DOT_STYLES[tone])} />}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="px-6 py-16 text-center">
      {Icon && (
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-slate-100">
          <Icon aria-hidden className="size-5 text-slate-400" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      )}
    </div>
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
  /** For grid placement — an Alert inside a two-column FormSection spans both. */
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset",
        BADGE_STYLES[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

// The dialog and form controls live in their own files — this module is already
// long — but re-exported here so screens import from one place.
export { Modal } from "./Modal";
export { FormDialog } from "./FormDialog";
export { ConfirmDialog } from "./ConfirmDialog";
export {
  SelectField,
  TextAreaField,
  CheckboxField,
  MultiSelectField,
  FormSection,
} from "./fields";
