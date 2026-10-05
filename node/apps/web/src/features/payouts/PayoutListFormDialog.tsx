import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, MessageCircle, Search } from "lucide-react";
import {
  createPayoutListSchema,
  type CreatePayoutList,
  type PayoutLine,
  type PayoutListDetail,
} from "@accountmanagement/contracts";
import { Alert, Button, FormDialog, FormSection, TextField } from "../../components/ui";
import { useRecordLayout } from "../../contexts/RecordLayoutContext";
import { ApiError } from "../../lib/api-client";
import { todayInput } from "../../lib/dates";
import { formatMoney } from "../../lib/format";
import { useCreatePayoutList, usePayoutList, usePayoutOutstanding, useUpdatePayoutList } from "./api";
import { fromPaise, sumAmounts, toPaise } from "./decimal";
import { ShareNotice, usePayoutSharing } from "./share";

/**
 * Build, edit or read a payout list: the header (date, title, budget, note) and
 * a table of the parties we owe, each with a tick and an amount.
 *
 * NOT react-hook-form. The header is four fields, but the lines are a SELECTION
 * over a list of hundreds of parties fed by a second query, and the contract
 * schema is run over the assembled body at submit. Held as plain state, every
 * error has an obvious home: a header field, a party's row, or the banner.
 *
 * AN ERROR ON A LINE MUST NEVER BE INVISIBLE (the `unshownValidationMessage`
 * lesson). A ticked party can be hidden by the search box, so an invalid submit
 * clears the search, and anything with no place to render goes to the banner.
 *
 * A LIST IS A PLAN, NOT A PAYMENT: saving never touches the ledger.
 */

type FieldName = "listDate" | "title" | "budget" | "note";
type Errors = {
  fields: Partial<Record<FieldName, string>>;
  /** By party, so the message sits on the row whatever order or filter is showing. */
  lines: Record<string, string>;
  /** `lines` as a whole: "Add at least one party". */
  noLines?: string;
  banner: string | null;
};
const NO_ERRORS: Errors = { fields: {}, lines: {}, banner: null };
const FIELDS: readonly string[] = ["listDate", "title", "budget", "note"];

/** One row of the builder: a party we owe, or a saved line whose party is no longer in the owed list. */
interface BuilderRow {
  partyId: string;
  partyName: string;
  /** What is owed NOW. "0" for a saved party that owes nothing any more. */
  owed: string;
  saved: PayoutLine | undefined;
}

type Issue = { path: ReadonlyArray<string | number>; message: string };

/** The server's "lines.0.amount" as the segments Zod gives on the client. */
const segments = (path: string): Array<string | number> =>
  path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));

/** Puts each issue where it renders. */
function placeIssues(issues: readonly Issue[], lineParties: readonly string[]): Errors {
  const errors: Errors = { fields: {}, lines: {}, banner: null };
  const stray: string[] = [];
  for (const issue of issues) {
    const [head, index] = issue.path;
    const party = typeof index === "number" ? lineParties[index] : undefined;
    if (typeof head === "string" && FIELDS.includes(head)) {
      errors.fields[head as FieldName] ??= issue.message;
    } else if (head === "lines" && party) {
      errors.lines[party] ??= issue.message;
    } else if (head === "lines" && index === undefined) {
      errors.noLines ??= issue.message;
    } else {
      stray.push(issue.message);
    }
  }
  const lineCount = Object.keys(errors.lines).length;
  errors.banner =
    stray[0] ??
    (lineCount > 0
      ? `${lineCount} ticked ${lineCount === 1 ? "party needs" : "parties need"} a correction - see the marked rows.`
      : null);
  return errors;
}

/** Strips what a pasted figure carries ("Rs 1,25,000") so the contract sees digits and a point. */
const cleanAmount = (value: string) => value.replace(/[,\s₹]/g, "");

export function PayoutListFormDialog({
  open,
  listId,
  readOnly = false,
  onClose,
}: {
  open: boolean;
  listId: string | null;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const isEdit = listId !== null;
  const detail = usePayoutList(open && isEdit ? listId : null);
  const outstanding = usePayoutOutstanding(open && !readOnly);
  const create = useCreatePayoutList();
  const update = useUpdatePayoutList();
  const share = usePayoutSharing();

  /**
   * THE SEARCH ROW AND THE COLUMN HEADINGS STAY PUT while the parties scroll
   * (client request, 5 Oct 2026), and the page is the ONE thing that scrolls.
   *
   * An earlier version scrolled the table inside its own box, which put two
   * vertical scrollbars on the page. Sticking the two rows inside the page's own
   * scroll gives the same effect with one.
   *
   * On a record page the title bar is sticky above them and about 41px tall; a
   * sticky offset resolves against the content box, 24px below the window edge
   * of the scroll area, so the rows start at 41 - 24 = 17px (1.1rem). In a dialog
   * or a side panel there is no such bar and the offset is 0. A fixed number for
   * a fixed bar: if the bar's height changes, this changes with it.
   */
  // From the layout setting, not `useWideSurface()`: that context is provided
  // INSIDE the record page, below this component, so here it is always false.
  const onPage = useRecordLayout().layout === "page";
  const stickyTop = onPage ? "1.1rem" : "0px";

  const [listDate, setListDate] = useState(todayInput);
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("");
  const [note, setNote] = useState("");
  /** The ticked parties and the amount typed for each. Presence = ticked. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [tickedOnly, setTickedOnly] = useState(false);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);

  /**
   * Seed once per opening, never on a refetch. The detail query refetches on
   * window focus; re-seeding from it would wipe the ticks and amounts being
   * typed. Cleared on close so the next opening seeds again.
   */
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seeded.current = null;
      return;
    }
    const key = listId ?? "new";
    if (seeded.current === key) return;
    if (!isEdit) {
      seeded.current = key;
      setListDate(todayInput());
      setTitle("");
      setBudget("");
      setNote("");
      setPicked({});
    } else if (detail.data) {
      seeded.current = key;
      setListDate(detail.data.listDate);
      setTitle(detail.data.title ?? "");
      setBudget(detail.data.budget ?? "");
      setNote(detail.data.note ?? "");
      setPicked(Object.fromEntries(detail.data.lines.map((line) => [line.partyId, line.amount])));
    } else {
      return;
    }
    setErrors(NO_ERRORS);
    setSearch("");
    setTickedOnly(false);
  }, [open, isEdit, listId, detail.data]);

  /**
   * THE OWED LIST PLUS EVERY SAVED LINE, by party.
   *
   * A saved party that has since been paid in full is no longer in the owed list.
   * Building the table from that list alone would drop its line on the next save
   * without anyone choosing to; so the saved lines are merged in, and the row
   * says what changed.
   */
  const rows = useMemo<BuilderRow[]>(() => {
    const savedBy = new Map((detail.data?.lines ?? []).map((line) => [line.partyId, line]));
    const owedRows: BuilderRow[] = (outstanding.data?.rows ?? []).map((row) => ({
      partyId: row.partyId,
      partyName: row.partyName,
      owed: row.outstanding,
      saved: savedBy.get(row.partyId),
    }));
    const listed = new Set(owedRows.map((row) => row.partyId));
    const gone: BuilderRow[] = (isEdit ? (detail.data?.lines ?? []) : [])
      .filter((line) => !listed.has(line.partyId))
      .map((line) => ({ partyId: line.partyId, partyName: line.partyName, owed: line.outstandingNow, saved: line }));
    return [...owedRows, ...gone];
  }, [outstanding.data, detail.data, isEdit]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (row) => (!needle || row.partyName.toLowerCase().includes(needle)) && (!tickedOnly || row.partyId in picked),
  );

  const tickedRows = rows.filter((row) => row.partyId in picked);
  const total = sumAmounts(tickedRows.map((row) => picked[row.partyId] ?? ""));
  const budgetPaise = toPaise(budget);
  const totalPaise = toPaise(total) ?? 0n;

  const toggle = (row: BuilderRow) =>
    setPicked((current) => {
      if (row.partyId in current) {
        const { [row.partyId]: _dropped, ...rest } = current;
        return rest;
      }
      // Prefilled with what is owed, and editable: a part payment is allowed.
      const owed = toPaise(row.owed);
      return { ...current, [row.partyId]: owed !== null && owed > 0n ? row.owed : "" };
    });

  const setAmount = (partyId: string, value: string) => {
    setPicked((current) => ({ ...current, [partyId]: cleanAmount(value) }));
    setErrors((current) => {
      if (!(partyId in current.lines)) return current;
      const { [partyId]: _cleared, ...lines } = current.lines;
      return { ...current, lines };
    });
  };

  const pending = create.isPending || update.isPending;

  const submit = async () => {
    const lines = tickedRows.map((row) => ({ partyId: row.partyId, amount: (picked[row.partyId] ?? "").trim() }));
    const order = lines.map((line) => line.partyId);
    const parsed = createPayoutListSchema.safeParse({ listDate, title, budget, note, lines });
    if (!parsed.success) {
      setErrors(placeIssues(parsed.error.issues, order));
      // A ticked party hidden by the search could carry the error; show them all.
      setSearch("");
      setTickedOnly(false);
      return;
    }
    setErrors(NO_ERRORS);
    const body: CreatePayoutList = parsed.data;
    try {
      if (isEdit) {
        await update.mutateAsync({ id: listId, body });
      } else {
        await create.mutateAsync(body);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.issues && error.issues.length > 0) {
        const placed = placeIssues(
          error.issues.map((issue) => ({ path: segments(issue.path), message: issue.message })),
          order,
        );
        setErrors({ ...placed, banner: placed.banner ?? error.message });
      } else {
        setErrors({
          ...NO_ERRORS,
          banner: error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
        });
      }
    }
  };

  const saved: PayoutListDetail | undefined = isEdit ? detail.data : undefined;

  const budgetLine =
    budgetPaise === null || budget.trim() === ""
      ? null
      : totalPaise > budgetPaise
        ? { over: true, text: `Over the budget by ${formatMoney(fromPaise(totalPaise - budgetPaise))}` }
        : { over: false, text: `${formatMoney(fromPaise(budgetPaise - totalPaise))} left of the budget` };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={() => void submit()}
      title={isEdit ? (readOnly ? "Payout list" : "Edit payout list") : "New payout list"}
      formError={errors.banner}
      pending={pending}
      readOnly={readOnly}
      submitLabel="Save list"
      size="xl"
      footerStart={
        <>
          {/*
            THE RUNNING TOTAL LIVES IN THE FOOTER, which is always on screen.

            It was a dark bar above the table, and the table scrolled inside its
            own box beneath it - two vertical scrollbars on one page, which the
            client asked to be one. With the table flowing in the page there is
            nothing to pin a bar to that works in all three record layouts, and
            the footer already is the one thing that never scrolls away.
          */}
          <div aria-live="polite" className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm text-slate-700">
            <span className="font-medium">
              {tickedRows.length} {tickedRows.length === 1 ? "party" : "parties"} ticked
            </span>
            {budgetLine && (
              <span className={clsx("font-medium", budgetLine.over ? "text-amber-700" : "text-emerald-700")}>
                {budgetLine.text}
              </span>
            )}
            <span>
              Total <span className="tabular ml-1 text-base font-semibold text-slate-900">{formatMoney(total)}</span>
            </span>
          </div>
          {saved && (
          <>
            {/* From the SAVED list: unsaved ticks are not in the message. */}
            <Button variant="outline" icon={MessageCircle} onClick={() => void share.whatsApp(saved)}>
              WhatsApp
            </Button>
            <Button variant="outline" icon={Copy} onClick={() => void share.copy(saved)}>
              Copy text
            </Button>
          </>
          )}
        </>
      }
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading list…</p>
      ) : (
        <>
          <ShareNotice notice={share.notice} />
          <FormSection title="List details" className="p-3!">
            <TextField
              label="List date"
              type="date"
              required
              value={listDate}
              onChange={(event) => setListDate(event.target.value)}
              error={errors.fields.listDate}
            />
            <TextField
              label="Title (optional)"
              placeholder="e.g. Weekly payout"
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              error={errors.fields.title}
            />
            {/*
              `inputMode`, not `type="number"`, which hands back a float: money is
              a decimal string end to end.
            */}
            <TextField
              label="Budget (optional)"
              inputMode="decimal"
              placeholder="What the owner can pay out"
              value={budget}
              onChange={(event) => setBudget(cleanAmount(event.target.value))}
              error={errors.fields.budget}
            />
            <TextField
              label="Note (optional)"
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              error={errors.fields.note}
            />
          </FormSection>

          <FormSection
            title="Parties to pay"
            className="p-3!"
            columns={1}
          >
            <div
              className={clsx(
                "sticky z-[5] flex h-11 items-center gap-3 border-b border-slate-200 bg-white",
                // The page card is `p-3` here; a dialog or panel has no card to bleed into.
                onPage && "-mx-3 px-3",
              )}
              style={{ top: stickyTop }}
            >
              <TextField
                label="Search parties"
                labelHidden
                icon={Search}
                placeholder="Search parties…"
                className="min-w-48 flex-1"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-brand-600"
                  checked={tickedOnly}
                  onChange={(event) => setTickedOnly(event.target.checked)}
                />
                Ticked only
              </label>
            </div>

            {errors.noLines && <Alert tone="danger">{errors.noLines}</Alert>}
            {outstanding.error && !readOnly && (
              <Alert tone="danger">
                {outstanding.error instanceof ApiError ? outstanding.error.message : "Could not load the parties we owe"}
              </Alert>
            )}

            {outstanding.isLoading && !readOnly ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading parties…</p>
            ) : (
              <div className="rounded-lg ring-1 ring-inset ring-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="sticky z-[4] w-10 bg-slate-50 px-3 py-1.5" style={{ top: `calc(${stickyTop} + 2.75rem)` }}>
                        <span className="sr-only">Pay</span>
                      </th>
                      <th className="sticky z-[4] bg-slate-50 px-2 py-1.5 text-left font-medium" style={{ top: `calc(${stickyTop} + 2.75rem)` }}>Party</th>
                      <th className="sticky z-[4] bg-slate-50 px-2 py-1.5 text-right font-medium" style={{ top: `calc(${stickyTop} + 2.75rem)` }}>Outstanding</th>
                      <th className="sticky z-[4] w-48 bg-slate-50 px-2 py-1.5 text-right font-medium" style={{ top: `calc(${stickyTop} + 2.75rem)` }}>Amount to pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                          {rows.length === 0 ? "No party has an outstanding to pay" : "No party matches this search"}
                        </td>
                      </tr>
                    )}
                    {shown.map((row) => {
                      const ticked = row.partyId in picked;
                      const amount = picked[row.partyId] ?? "";
                      const flag = ticked ? lineFlag(row, amount) : null;
                      return (
                        <tr
                          key={row.partyId}
                          className={clsx("cursor-pointer transition-colors", ticked ? "bg-brand-50 hover:bg-brand-100/70" : "hover:bg-slate-100")}
                          onClick={(event) => {
                            // A click on the amount box or the box itself is theirs, not the row's.
                            if ((event.target as HTMLElement).closest("input, button, a, label")) return;
                            toggle(row);
                          }}
                        >
                          <td className="px-3 py-1 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Pay ${row.partyName}`}
                              className="mt-1 size-4 rounded border-slate-300 text-brand-600"
                              checked={ticked}
                              onChange={() => toggle(row)}
                            />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <div className="pt-0.5 font-medium text-slate-900">{row.partyName}</div>
                            {flag && <div className="mt-0.5 text-xs text-amber-700">{flag}</div>}
                          </td>
                          <td className="tabular px-2 py-1 pt-1.5 text-right align-top text-slate-700">
                            {formatMoney(row.owed)}
                          </td>
                          <td className="px-2 py-1 align-top">
                            {ticked ? (
                              <TextField
                                label={`Amount for ${row.partyName}`}
                                labelHidden
                                compact
                                inputMode="decimal"
                                placeholder="0.00"
                                className="[&_input]:text-right"
                                value={amount}
                                onChange={(event) => setAmount(row.partyId, event.target.value)}
                                error={errors.lines[row.partyId]}
                              />
                            ) : (
                              <span className="block pt-1 text-right text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

/**
 * What to flag on a ticked row, from the amount as it stands NOW - so correcting
 * the amount clears the flag. Warn, never block: paying more than is owed is
 * sometimes an advance, and the office knows.
 */
function lineFlag(row: BuilderRow, amount: string): string | null {
  const owed = toPaise(row.owed) ?? 0n;
  if (owed <= 0n) {
    return row.saved
      ? "This party no longer owes anything - it has been paid since this list was saved."
      : "This party owes nothing at present.";
  }
  const typed = toPaise(amount);
  if (typed === null || typed <= owed) return null;
  return row.saved
    ? `This party has been paid since - only ${formatMoney(row.owed)} is owed now.`
    : `More than the ${formatMoney(row.owed)} owed.`;
}
