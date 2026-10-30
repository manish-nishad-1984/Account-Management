import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Button, Modal, SelectField, TextField } from "../../components/ui";
import { formatMoney } from "../../lib/format";
import { todayInput } from "../../lib/dates";
import { fromPaise, toPaise } from "./decimal";
import { formatListDate } from "./message";
import { AgeBadge, ageInDays } from "./AgeBadge";
import { PartPaid } from "./PartPaid";

export interface FilterableBill {
  key: string;
  displayNo: string;
  documentDate: string | null;
  siteName: string | null;
  pending: string;
  /** An invoice, or the party's opening balance. */
  source?: "invoice" | "opening_balance";
  /** The bill's own total; with it, a bill paid in part says so. */
  billAmount?: string;
}

/** The date part of an ISO date or timestamp, to compare as text. */
const dayOf = (value: string | null): string => (value ?? "").slice(0, 10);

/** "1,25,000.50" or "125000" as paise; blank or not an amount is null. */
const amountOf = (value: string): bigint | null => (value.trim() === "" ? null : toPaise(value.replace(/,/g, "")));

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

type Preset = "30" | "month" | "lastMonth" | "fy" | "all";

/** From and To for a quick date choice, in local dates. The financial year runs 1 April to 31 March. */
export function presetRange(preset: Preset, today: string = todayInput()): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "30": {
      const start = new Date(y, m - 1, Number(today.slice(8, 10)) - 30);
      return { from: isoOf(start), to: today };
    }
    case "month":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "lastMonth":
      return { from: isoOf(new Date(y, m - 2, 1)), to: isoOf(new Date(y, m - 1, 0)) };
    case "fy": {
      const start = m >= 4 ? y : y - 1;
      return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
    }
    default:
      return { from: "", to: "" };
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "30", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "fy", label: "This financial year" },
];

type AgeBucket = "" | "0-30" | "31-60" | "61-90" | "90+";
const AGES: { value: AgeBucket; label: string }[] = [
  { value: "", label: "Any age" },
  { value: "0-30", label: "Up to 30 days" },
  { value: "31-60", label: "31 – 60 days" },
  { value: "61-90", label: "61 – 90 days" },
  { value: "90+", label: "Over 90 days" },
];
const inBucket = (days: number | null, bucket: AgeBucket): boolean => {
  if (bucket === "") return true;
  if (days === null) return false;
  if (bucket === "0-30") return days <= 30;
  if (bucket === "31-60") return days > 30 && days <= 60;
  if (bucket === "61-90") return days > 60 && days <= 90;
  return days > 90;
};

type Sort = "old" | "new" | "high" | "low";
const SORTS: { value: Sort; label: string }[] = [
  { value: "old", label: "Oldest first" },
  { value: "new", label: "Newest first" },
  { value: "high", label: "Pending: high to low" },
  { value: "low", label: "Pending: low to high" },
];

/**
 * "Filter" beside a party on the payout builder (client request, 17 Oct 2026; made
 * wider with more ways to choose, 19 Oct 2026, for a party with some 300 bills).
 *
 * The bills that pass the filters (dates, age, site, type, bill number, pending
 * amount) are shown, ticked as the party's bills are ticked now - all of them when
 * none is (client, 30 Oct 2026: a saved choice must not come back as "all"); the person can untick any, tick or untick all
 * shown at once, shift-click a range, or tick the oldest shown bills that fit a
 * sum to pay. OK ticks exactly the shown, ticked bills on the party in the builder
 * (and unticks the party's others). Cancel changes nothing.
 */
export function PartyBillFilterDialog({
  partyName,
  bills,
  ticked = [],
  onApply,
  onClose,
}: {
  /** Null keeps it closed. */
  partyName: string | null;
  /** The party's bills that can still be paid. */
  bills: FilterableBill[];
  /** The party's bills ticked in the builder now; none means start with all. */
  ticked?: string[];
  onApply: (keys: string[]) => void;
  onClose: () => void;
}) {
  const open = partyName !== null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [age, setAge] = useState<AgeBucket>("");
  const [site, setSite] = useState("");
  const [kind, setKind] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sort, setSort] = useState<Sort>("old");
  const [budget, setBudget] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  /** The ticks as the builder has them: the bills not ticked there start unticked. */
  const startingOff = () => {
    const now = new Set(ticked);
    return new Set(now.size === 0 ? [] : bills.filter((bill) => !now.has(bill.key)).map((bill) => bill.key));
  };

  const clearFilters = () => {
    setFrom("");
    setTo("");
    setSearch("");
    setAge("");
    setSite("");
    setKind("");
    setMinAmount("");
    setMaxAmount("");
    setSort("old");
    setBudget("");
    lastClicked.current = null;
  };

  useEffect(() => {
    if (!open) return;
    clearFilters();
    setOff(startingOff());
    // Once per opening: a refetch of the bills must not undo the person's ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sites = useMemo(
    () => [...new Set(bills.map((bill) => bill.siteName).filter((name): name is string => !!name))].sort(),
    [bills],
  );
  const hasOpening = bills.some((bill) => bill.source === "opening_balance");
  const hasInvoice = bills.some((bill) => bill.source !== "opening_balance");

  const min = amountOf(minAmount);
  const max = amountOf(maxAmount);
  const badMin = minAmount.trim() !== "" && min === null;
  const badMax = maxAmount.trim() !== "" && max === null;
  const badRange = from !== "" && to !== "" && to < from;

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    const list = bills.filter((bill) => {
      const day = dayOf(bill.documentDate);
      if (from && (!day || day < from)) return false;
      if (to && (!day || day > to)) return false;
      if (!inBucket(ageInDays(bill.documentDate), age)) return false;
      if (site && bill.siteName !== site) return false;
      if (kind === "invoice" && bill.source === "opening_balance") return false;
      if (kind === "opening_balance" && bill.source !== "opening_balance") return false;
      if (words && !bill.displayNo.toLowerCase().includes(words)) return false;
      const pending = toPaise(bill.pending) ?? 0n;
      if (min !== null && pending < min) return false;
      if (max !== null && pending > max) return false;
      return true;
    });
    const byDate = (a: FilterableBill, b: FilterableBill) => dayOf(a.documentDate).localeCompare(dayOf(b.documentDate));
    const byPending = (a: FilterableBill, b: FilterableBill) => {
      const diff = (toPaise(a.pending) ?? 0n) - (toPaise(b.pending) ?? 0n);
      return diff === 0n ? 0 : diff < 0n ? -1 : 1;
    };
    const compare = { old: byDate, new: (a: FilterableBill, b: FilterableBill) => byDate(b, a), high: (a: FilterableBill, b: FilterableBill) => byPending(b, a), low: byPending }[sort];
    return [...list].sort(compare);
  }, [bills, from, to, age, site, kind, search, min, max, sort]);

  const chosen = shown.filter((bill) => !off.has(bill.key));
  const total = fromPaise(chosen.reduce((sum, bill) => sum + (toPaise(bill.pending) ?? 0n), 0n));
  const shownTotal = fromPaise(shown.reduce((sum, bill) => sum + (toPaise(bill.pending) ?? 0n), 0n));
  const allTicked = shown.length > 0 && chosen.length === shown.length;
  const someTicked = chosen.length > 0 && !allTicked;

  const setTicked = (keys: string[], ticked: boolean) =>
    setOff((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (ticked) next.delete(key);
        else next.add(key);
      }
      return next;
    });

  /** A click ticks or unticks one bill; with Shift, every shown bill from the last one clicked to this. */
  const onBillClick = (event: MouseEvent<HTMLInputElement>, key: string) => {
    const ticked = event.currentTarget.checked;
    const anchor = lastClicked.current;
    const at = shown.findIndex((bill) => bill.key === key);
    const start = anchor ? shown.findIndex((bill) => bill.key === anchor) : -1;
    if (event.shiftKey && start >= 0 && at >= 0) {
      const [a, b] = start < at ? [start, at] : [at, start];
      setTicked(shown.slice(a, b + 1).map((bill) => bill.key), ticked);
    } else {
      setTicked([key], ticked);
    }
    lastClicked.current = key;
  };

  /** Tick the oldest shown bills, one after another, while they fit the sum; untick the rest. */
  const budgetPaise = amountOf(budget);
  const fillBudget = () => {
    if (budgetPaise === null) return;
    const oldestFirst = [...shown].sort((a, b) => dayOf(a.documentDate).localeCompare(dayOf(b.documentDate)));
    let left = budgetPaise;
    const keep = new Set<string>();
    for (const bill of oldestFirst) {
      const pending = toPaise(bill.pending) ?? 0n;
      if (pending > left) break;
      left -= pending;
      keep.add(bill.key);
    }
    setOff(new Set(shown.filter((bill) => !keep.has(bill.key)).map((bill) => bill.key)));
  };

  const preset = PRESETS.find((p) => {
    const range = presetRange(p.value);
    return range.from === from && range.to === to;
  })?.value;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Filter bills · ${partyName ?? ""}`}
      description="Narrow the bills with any of the filters; the ticked bills shown are ticked for this party when you press OK"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={badRange || badMin || badMax} onClick={() => onApply(chosen.map((bill) => bill.key))}>
            OK
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick dates">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={preset === p.value}
            onClick={() => {
              const range = presetRange(p.value);
              setFrom(range.from);
              setTo(range.to);
            }}
            className={clsx(
              "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
              preset === p.value
                ? "bg-brand-600 text-white ring-brand-600"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-brand-50 hover:text-brand-700",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <TextField label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextField label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <SelectField id="bill-filter-age" label="Age" value={age} options={AGES} onChange={(event) => setAge(event.target.value as AgeBucket)} />
        <TextField id="bill-filter-search" label="Bill no. contains" value={search} placeholder="e.g. 26-27/15" onChange={(event) => setSearch(event.target.value)} />
        <TextField
          id="bill-filter-min"
          label="Pending from ₹"
          inputMode="decimal"
          value={minAmount}
          error={badMin ? "Not an amount" : undefined}
          onChange={(event) => setMinAmount(event.target.value)}
        />
        <TextField
          id="bill-filter-max"
          label="Pending up to ₹"
          inputMode="decimal"
          value={maxAmount}
          error={badMax ? "Not an amount" : undefined}
          onChange={(event) => setMaxAmount(event.target.value)}
        />
        {sites.length > 1 ? (
          <SelectField
            id="bill-filter-site"
            label="Site"
            value={site}
            options={[{ value: "", label: "All sites" }, ...sites.map((name) => ({ value: name, label: name }))]}
            onChange={(event) => setSite(event.target.value)}
          />
        ) : hasOpening && hasInvoice ? null : (
          <span className="hidden md:block" />
        )}
        {hasOpening && hasInvoice && (
          <SelectField
            id="bill-filter-kind"
            label="Type"
            value={kind}
            options={[
              { value: "", label: "Bills and opening balance" },
              { value: "invoice", label: "Bills only" },
              { value: "opening_balance", label: "Opening balance only" },
            ]}
            onChange={(event) => setKind(event.target.value)}
          />
        )}
        <SelectField id="bill-filter-sort" label="Sort by" value={sort} options={SORTS} onChange={(event) => setSort(event.target.value as Sort)} />
      </div>
      {badRange && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          The To date is before the From date.
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={() => setTicked(shown.map((bill) => bill.key), true)}>
            Tick all shown
          </Button>
          <Button size="sm" variant="secondary" disabled={chosen.length === 0} onClick={() => setTicked(shown.map((bill) => bill.key), false)}>
            Untick all shown
          </Button>
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <TextField
            id="bill-filter-budget"
            label="Pay up to ₹ (oldest first)"
            inputMode="decimal"
            compact
            value={budget}
            placeholder="e.g. 5,00,000"
            className="w-48"
            onChange={(event) => setBudget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                fillBudget();
              }
            }}
          />
          <Button size="sm" variant="outline" disabled={budgetPaise === null || shown.length === 0} onClick={fillBudget}>
            Tick to fit
          </Button>
        </div>
      </div>

      <div className="max-h-[55vh] overflow-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tick all shown bills"
                  className="size-4 rounded border-slate-300 text-brand-600"
                  checked={allTicked}
                  ref={(node) => {
                    if (node) node.indeterminate = someTicked;
                  }}
                  disabled={shown.length === 0}
                  onChange={() => setTicked(shown.map((bill) => bill.key), !allTicked)}
                />
              </th>
              <th className="px-2 py-2">Bill no.</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2">Site</th>
              <th className="px-3 py-2 text-right">Pending</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No bill of this party matches these filters
                </td>
              </tr>
            )}
            {shown.map((bill) => (
              <tr key={bill.key} className={clsx("hover:bg-slate-50", !off.has(bill.key) && "bg-brand-50/40")}>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Pay bill ${bill.displayNo}`}
                    className="size-4 rounded border-slate-300 text-brand-600"
                    checked={!off.has(bill.key)}
                    onClick={(event) => onBillClick(event, bill.key)}
                    onChange={() => {}}
                  />
                </td>
                <td className="px-2 py-1.5 font-medium text-slate-700">
                  {bill.displayNo}
                  {bill.source === "opening_balance" && <span className="ml-2 text-xs font-normal text-slate-500">Opening balance</span>}
                  <span className="font-normal">
                    <PartPaid billAmount={bill.billAmount} pending={bill.pending} />
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{bill.documentDate ? formatListDate(bill.documentDate) : "—"}</td>
                <td className="px-2 py-1.5">
                  <AgeBadge documentDate={bill.documentDate} />
                </td>
                <td className="px-2 py-1.5 text-slate-600">{bill.siteName ?? "—"}</td>
                <td className="tabular px-3 py-1.5 text-right text-slate-700">{formatMoney(bill.pending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-slate-600" aria-live="polite">
        {chosen.length} of {bills.length} {bills.length === 1 ? "bill" : "bills"} will be ticked, totalling{" "}
        <span className="tabular font-medium text-slate-900">{formatMoney(total)}</span>
        <span className="text-slate-400">
          {" "}
          · {shown.length} shown, pending {formatMoney(shownTotal)} · Shift-click ticks a range
        </span>
      </p>
    </Modal>
  );
}
