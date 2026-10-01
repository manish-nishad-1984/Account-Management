import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "../../components/ui";
import { useFitHeight } from "../../lib/use-fit-height";

/**
 * A report's figures as a ruled grid — the look of a spreadsheet, because that
 * is what an accountant reads a ledger against (client request, 18 Sep 2026:
 * "proper grid me, amount perfect align with column header").
 *
 * WHY THE OLD TABLES DID NOT READ AS ALIGNED, although every amount was in fact
 * right-aligned under its header: no column rules, so across a wide gap nothing
 * tied a figure to its heading; rows of two lines, where a badge sat under the
 * document number; and "Part paid" stacked under an amount. Each is fixed here:
 *
 *  - Every cell is ruled, so each figure sits in a box under its own heading.
 *  - Every amount column has the same width, so the figures form even columns
 *    across the grid. The layout is otherwise the browser's own: a fixed layout
 *    was tried first and starved the names of room, wrapping them to three lines.
 *    Alignment never depended on it — every cell in a column shares one box.
 *  - Amounts are right-aligned in tabular figures with the header aligned the
 *    same way and padded the same, so the last digit of every row and the last
 *    letter of the header share one edge.
 *  - Labels such as the entry type have a column of their own, so an amount
 *    never shares its cell. Names WRAP rather than being cut off — a ledger
 *    that shows "Zenith ..." has hidden the one thing it was opened to read —
 *    and each row is top-aligned, so every amount sits on its row's first line.
 *  - The header stays at the top while the grid scrolls, and the totals at the
 *    bottom, so neither is ever out of sight of the figures.
 *  - The row under the pointer is tinted a little darker (client request, 18 Sep
 *    2026). The tint is translucent, so it darkens whatever the cell already is
 *    and the coloured figures keep their colour.
 */
export interface ReportColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Amounts: right-aligned, tabular, one shared width, never wrapped. */
  numeric?: boolean;
  /** Short values that read badly broken — a number, a date, a label. */
  nowrap?: boolean;
  /** A CSS width. Amount columns default to one shared width. */
  width?: string;
  /** Extra classes for this column's body cells, from the row — a colour for a sign. */
  className?: (row: T) => string | undefined;
  /** This column's cell in the totals row. */
  footer?: ReactNode;
}

/** "1,23,45,678.00" — a crore — in tabular figures with the cell's padding. A larger figure widens its own column. */
const AMOUNT_WIDTH = "7.5rem";

export function ReportGrid<T>({
  label,
  columns,
  rows,
  rowKey,
  footerLabel,
  minWidth = "56rem",
  fit = false,
}: {
  /** The table's accessible name. */
  label: string;
  columns: Array<ReportColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** Spans the columns before the first one with a footer. */
  footerLabel?: ReactNode;
  minWidth?: string;
  /** Fill the height left on the page, so the page itself never scrolls. */
  fit?: boolean;
}) {
  const fitted = useFitHeight(fit);
  const firstFooter = columns.findIndex((column) => column.footer !== undefined);
  const hasFooter = firstFooter !== -1;

  return (
    <div
      ref={fitted.ref}
      className={clsx(
        "scroll-subtle overflow-auto rounded-lg border border-slate-300 bg-white",
        !fit && "max-h-[70vh]",
      )}
      style={fit ? { maxHeight: fitted.height } : undefined}
    >
      <table aria-label={label} className="w-full border-separate border-spacing-0 text-[13px]" style={{ minWidth }}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width ?? (column.numeric ? AMOUNT_WIDTH : undefined) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={clsx(
                  "sticky top-0 z-10 border-b border-slate-300 bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700",
                  index < columns.length - 1 && "border-r",
                  column.numeric ? "text-right" : "text-left",
                  (column.numeric || column.nowrap) && "whitespace-nowrap",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="align-top hover:[&>td]:bg-slate-900/[0.06]">
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={clsx(
                    "border-b border-slate-200 px-2.5 py-1.5",
                    index < columns.length - 1 && "border-r",
                    column.numeric
                      ? "tabular whitespace-nowrap text-right"
                      : clsx("text-slate-700", column.nowrap ? "whitespace-nowrap" : "break-words"),
                    column.className?.(row),
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasFooter && (
          <tfoot>
            <tr>
              {firstFooter > 0 && (
                <td
                  colSpan={firstFooter}
                  className="sticky bottom-0 border-r border-t-2 border-slate-300 bg-slate-100 px-2.5 py-2 font-semibold text-slate-700"
                >
                  {footerLabel}
                </td>
              )}
              {columns.slice(firstFooter).map((column, index) => (
                <td
                  key={column.key}
                  className={clsx(
                    "sticky bottom-0 border-t-2 border-slate-300 bg-slate-100 px-2.5 py-2 font-semibold",
                    firstFooter + index < columns.length - 1 && "border-r",
                    column.numeric && "tabular whitespace-nowrap text-right",
                  )}
                >
                  {column.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * A document number, never broken inside itself.
 *
 * A browser breaks a line at a hyphen, so "BE-2026-27-4723" came out as two
 * lines, "BE-2026-27-" over "4723" — a number nobody can read at a glance or
 * copy whole. Each word is kept whole instead; a reference that IS a phrase,
 * such as "Balance brought forward", still wraps between its words.
 */
export function DocumentNo({ value }: { value: string }) {
  const words = value.split(" ");
  return (
    <span className="font-medium text-slate-900">
      {words.map((word, index) => (
        <span key={index} className="whitespace-nowrap">
          {word}
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * An entry's type as coloured text rather than a pill: a pill's padding and
 * ring cost the width the party and site names need to stay on one line.
 */
export function TypeLabel({ tone, children }: { tone: "neutral" | "warning" | "info"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "text-xs font-medium",
        tone === "neutral" && "text-slate-600",
        tone === "warning" && "text-amber-700",
        tone === "info" && "text-sky-700",
      )}
    >
      {children}
    </span>
  );
}

export const REPORT_PAGE = 50;

/** Previous / Next under a report grid. */
export function ReportPager({
  offset,
  total,
  hasNext,
  onPage,
  note,
}: {
  offset: number;
  total: number;
  hasNext: boolean;
  onPage: (offset: number) => void;
  note?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>
        Showing {total === 0 ? 0 : offset + 1} to {Math.min(offset + REPORT_PAGE, total)} of {total}.
        {note ? ` ${note}` : ""}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - REPORT_PAGE))}>
          Previous
        </Button>
        <Button variant="secondary" disabled={!hasNext} onClick={() => onPage(offset + REPORT_PAGE)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export type ReportTab = "ledger" | "balances";

/**
 * Ledger | Balance summary, one showing at a time (client request, 18 Sep 2026).
 *
 * `tabs` narrows it to the ones a page keeps. Since 1 Oct 2026 the Ledger page
 * keeps only its ledger and Pending Outstanding only its summary (client
 * request); a lone tab still heads the page, standing in for the title.
 *
 * A real tab list: arrow keys move between the two, and each tab names the panel
 * it controls, so a screen reader announces where the reader has landed.
 */
export function ReportTabs({
  value,
  onChange,
  labels,
  tabs = ["ledger", "balances"],
  panel,
  actions,
}: {
  value: ReportTab;
  onChange: (tab: ReportTab) => void;
  labels: Partial<Record<ReportTab, string>>;
  /** Which tabs to show, in order. Both unless a page says otherwise. */
  tabs?: ReportTab[];
  /** Controls at the right end of the tab row, for a page whose tabs stand in for its title. */
  actions?: ReactNode;
  panel: (tab: ReportTab, ids: { panelId: string; tabId: string }) => ReactNode;
}) {
  const base = useId();
  const order = tabs;
  const buttons = useRef<Record<ReportTab, HTMLButtonElement | null>>({ ledger: null, balances: null });
  const ids = (tab: ReportTab) => ({ tabId: `${base}-tab-${tab}`, panelId: `${base}-panel-${tab}` });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = order[(order.indexOf(value) + 1) % order.length]!;
    onChange(next);
    buttons.current[next]?.focus();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-slate-200">
      <div role="tablist" aria-label="Report" className="flex gap-1" onKeyDown={onKeyDown}>
        {order.map((tab) => {
          const selected = tab === value;
          return (
            <button
              key={tab}
              ref={(element) => {
                buttons.current[tab] = element;
              }}
              type="button"
              role="tab"
              id={ids(tab).tabId}
              aria-selected={selected}
              aria-controls={ids(tab).panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab)}
              className={clsx(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
              )}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>
      {actions && <div className="pb-1.5">{actions}</div>}
      </div>
      <div role="tabpanel" id={ids(value).panelId} aria-labelledby={ids(value).tabId}>
        {panel(value, ids(value))}
      </div>
    </>
  );
}
