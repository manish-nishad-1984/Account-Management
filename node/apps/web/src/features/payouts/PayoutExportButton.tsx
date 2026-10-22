import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import {
  PAYOUT_DETAIL_MAX_IDS,
  payoutDetailResponseSchema,
  type PayoutExportLine,
  type PayoutInvoice,
  type PayoutListRow,
} from "@accountmanagement/contracts";
import { Button } from "../../components/ui";
import { apiRequest } from "../../lib/api-client";
import { downloadGridExcel, exportAmount, exportDate, fetchAllRows, type ExportColumn } from "../../lib/grid-export";
import type { ListFilters, ListParams } from "../../lib/list-query";

/**
 * One row of the sheet with details: a bill of a party on a list, a party kept
 * with no bills, or a list with no party at all.
 */
export interface PayoutDetailRow {
  list: PayoutListRow;
  line: PayoutExportLine | null;
  bill: PayoutInvoice | null;
  /** The list's first row and the party's first row: their totals are written there only, so a column sums right. */
  firstOfList: boolean;
  firstOfParty: boolean;
}

export const WITH_DETAILS_COLUMNS: ExportColumn<PayoutDetailRow>[] = [
  { header: "List date", width: 12, value: (row) => exportDate(row.list.listDate) },
  { header: "Title", width: 28, value: (row) => row.list.title },
  { header: "Company", width: 26, value: (row) => row.list.companyName },
  { header: "Status", width: 11, value: (row) => (row.list.status === "confirmed" ? "Confirmed" : "Draft") },
  { header: "Party", width: 32, value: (row) => row.line?.partyName },
  { header: "Party amount", width: 15, align: "right", value: (row) => (row.firstOfParty ? exportAmount(row.line?.amount) : "") },
  { header: "Extra paid", width: 13, align: "right", value: (row) => (row.firstOfParty ? exportAmount(row.line?.extraPaid) : "") },
  { header: "Type", width: 15, value: (row) => (row.bill ? (row.bill.source === "opening_balance" ? "Opening balance" : "Bill") : "") },
  { header: "Bill no.", width: 20, value: (row) => row.bill?.displayNo },
  { header: "Bill date", width: 12, value: (row) => exportDate(row.bill?.documentDate) },
  { header: "Site", width: 22, value: (row) => row.bill?.siteName },
  { header: "Bill amount", width: 15, align: "right", value: (row) => exportAmount(row.bill?.amount) },
  { header: "Pending when saved", width: 15, align: "right", value: (row) => exportAmount(row.bill?.pendingAtSave) },
  { header: "Paid", width: 15, align: "right", value: (row) => exportAmount(row.bill?.paidAmount) },
  { header: "List total", width: 16, align: "right", value: (row) => (row.firstOfList ? exportAmount(row.list.total) : "") },
  { header: "Confirmed on", width: 12, value: (row) => exportDate(row.list.confirmedAt) },
  { header: "Created by", width: 20, value: (row) => row.list.createdByName },
];

/** Each list followed by its parties, each party by its bills, in the list's order. */
export function toDetailRows(lists: PayoutListRow[], lines: PayoutExportLine[]): PayoutDetailRow[] {
  const byList = new Map<string, PayoutExportLine[]>();
  for (const line of lines) byList.set(line.payoutListId, [...(byList.get(line.payoutListId) ?? []), line]);
  return lists.flatMap((list): PayoutDetailRow[] => {
    const own = byList.get(list.id) ?? [];
    if (own.length === 0) return [{ list, line: null, bill: null, firstOfList: true, firstOfParty: false }];
    const rows: PayoutDetailRow[] = [];
    for (const line of own) {
      const bills: (PayoutInvoice | null)[] = line.invoices.length > 0 ? line.invoices : [null];
      bills.forEach((bill, index) => rows.push({ list, line, bill, firstOfList: rows.length === 0, firstOfParty: index === 0 }));
    }
    return rows;
  });
}

/** Every list the filters match, each followed by its parties and bills — the sheet "with details". */
export async function fetchPayoutDetailRows(
  params: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>,
  filters: ListFilters,
): Promise<PayoutDetailRow[]> {
  const lists = await fetchAllRows<PayoutListRow>("payout-lists", params, filters);
  const lines: PayoutExportLine[] = [];
  for (let at = 0; at < lists.length; at += PAYOUT_DETAIL_MAX_IDS) {
    const ids = lists.slice(at, at + PAYOUT_DETAIL_MAX_IDS).map((list) => list.id);
    const page = await apiRequest("/payout-lists/lines", { method: "POST", body: { ids }, schema: payoutDetailResponseSchema });
    lines.push(...page.lines);
  }
  return toDetailRows(lists, lines);
}

/**
 * "Export to Excel" on the payout lists, two ways (client, 22 Oct 2026): the
 * lists alone, one row each, as before; or WITH DETAILS, one row per bill of
 * each party on each list. Both export the whole filtered set, not the page.
 */
export function PayoutExportButton({
  params,
  filters,
  listColumns,
}: {
  params: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>;
  filters: ListFilters;
  /** The sheet without details. */
  listColumns: ExportColumn<PayoutListRow>[];
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const run = async (withDetails: boolean) => {
    setMenu(false);
    setBusy(true);
    setFailed(null);
    try {
      if (!withDetails) {
        await downloadGridExcel<PayoutListRow>({
          resource: "payout-lists",
          params,
          filters,
          columns: listColumns,
          sheetName: "Payout lists",
          fileName: "Payout-lists",
        });
        return;
      }
      await downloadGridExcel<PayoutDetailRow>({
        resource: "payout-lists",
        columns: WITH_DETAILS_COLUMNS,
        rows: await fetchPayoutDetailRows(params, filters),
        sheetName: "Payout list details",
        fileName: "Payout-lists-with-details",
      });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(false);
    }
  };

  const choice =
    "group block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-600 hover:text-white focus-visible:bg-brand-600 focus-visible:text-white focus-visible:outline-none";

  return (
    <span ref={box} className="relative inline-flex items-center gap-2">
      <Button
        variant="secondary"
        icon={FileSpreadsheet}
        loading={busy}
        loadingLabel="Exporting…"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        Export to Excel
        <ChevronDown aria-hidden className="size-3.5" />
      </Button>
      {menu && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg bg-white py-1 shadow-pop ring-1 ring-slate-200">
          <button type="button" role="menuitem" className={choice} onClick={() => void run(false)}>
            Lists only
            <span className="block text-xs text-slate-500 group-hover:text-brand-100 group-focus-visible:text-brand-100">One row per payout list</span>
          </button>
          <button type="button" role="menuitem" className={choice} onClick={() => void run(true)}>
            With details
            <span className="block text-xs text-slate-500 group-hover:text-brand-100 group-focus-visible:text-brand-100">Every party and bill of each list</span>
          </button>
        </div>
      )}
      {failed && (
        <span role="alert" className="text-sm text-red-700">
          {failed}
        </span>
      )}
    </span>
  );
}
