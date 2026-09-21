import clsx from "clsx";
import { forwardRef, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/**
 * Tooltip and IconButton, in their own module rather than in the `ui` barrel.
 *
 * NOT A STYLE DECISION - A CYCLE. `Modal`, `SidePanel` and `RecordPage` all need
 * an icon button for their close control, and all three are re-exported BY the
 * barrel; importing the barrel from inside them closes a loop that a bundler
 * resolves by handing one of the two an undefined binding, which surfaces at
 * runtime as "Component is not a function" in whichever one happened to load
 * first. Leaves of the graph go in their own file.
 */

/**
 * A small label that follows the pointer to an icon-only control.
 *
 * PORTALLED AND FIXED, for the reason the item picker's listbox is: the row
 * actions live inside a table with `overflow-x: auto`, and an element that
 * scrolls one axis clips the other - an absolutely-positioned tip on the Delete
 * button would be cut off by the edge of the grid it is trying to explain.
 *
 * `aria-hidden`, because it is NOT the accessible name. Every control that uses
 * this already carries an `aria-label` saying the same words, so announcing the
 * tip as well would read the label twice. The tip is for the sighted user who is
 * looking at an icon and wondering.
 *
 * It REPLACES `title`, and must: the native tooltip appears after its own delay
 * in its own corner, so keeping both meant two tooltips saying the same thing a
 * second apart.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setAt({ left: rect.left + rect.width / 2, top: rect.top });
  };
  const hide = () => setAt(null);

  return (
    <>
      <span
        ref={anchor}
        className={clsx("inline-flex", className)}
        onPointerEnter={show}
        onPointerLeave={hide}
        // Focus as well as hover, so the tip is reachable from the keyboard. A
        // click dismisses it - otherwise it hangs over the dialog it just opened.
        onFocusCapture={show}
        onBlurCapture={hide}
        onClick={hide}
      >
        {children}
      </span>
      {at &&
        createPortal(
          <span
            aria-hidden
            style={{ left: at.left, top: at.top - 6 }}
            className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium leading-4 text-white shadow-pop"
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

/**
 * An action with no room for its name: a row's Edit, a panel's Close.
 *
 * The name is not optional here, it is merely not drawn. `label` becomes the
 * aria-label AND the tooltip, so the control is equally usable by someone
 * reading the screen and someone listening to it. A bare icon button with no
 * accessible name is the most common accessibility defect in an admin UI, and
 * this component makes it unrepresentable.
 */
export type IconTone = "default" | "operation" | "destructive" | "success";

const ICON_TONES: Record<IconTone, string> = {
  default: "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
  operation: "text-brand-600 hover:bg-brand-50 hover:text-brand-700",
  destructive: "text-rose-600 hover:bg-rose-50 hover:text-rose-700",
  success: "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700",
};

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    label: string;
    icon: LucideIcon;
    tone?: IconTone;
    /** 28px box with a 14px mark, or 36px with a 16px one. */
    size?: "sm" | "md";
  }
>(function IconButton(
  { label, icon: Icon, tone = "default", size = "sm", className, type = "button", ...rest },
  ref,
) {
  return (
    <Tooltip label={label}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={clsx(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
          "focus-visible:outline-brand-500",
          "disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent",
          size === "sm" ? "size-7" : "size-9",
          ICON_TONES[tone],
          className,
        )}
        {...rest}
      >
        <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />
      </button>
    </Tooltip>
  );
});
