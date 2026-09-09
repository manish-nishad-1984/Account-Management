import { useQuery } from "@tanstack/react-query";
import {
  balancesResponseSchema,
  ledgerResponseSchema,
  reportFileName,
  type BalancesResponse,
  type LedgerResponse,
} from "@accountmanagement/contracts";
import { apiRequest, downloadRequest } from "../../lib/api-client";
import { saveBlob } from "../../lib/download";

const RESOURCE = "reports";

export interface ReportQuery {
  direction?: "out" | "in";
  companyId?: string;
  siteId?: string;
  partyId?: string;
  siteGroupId?: string;
  fromDate?: string;
  toDate?: string;
  show?: "all" | "outstanding";
  limit?: number;
  offset?: number;
}

/**
 * Only defined, non-empty values reach the URL.
 *
 * An empty filter dropdown submits `""`, which the server's `.uuid()` would
 * refuse — the same defect §5l found on inward challans, where an unselected
 * supplier made the form unsavable and the message was attached to a field
 * nobody looked at. Dropped here rather than sent.
 */
const toSearch = (query: ReportQuery): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
};

/** Panel 2 — the running-balance ledger. */
export const useLedger = (query: ReportQuery, enabled = true) =>
  useQuery({
    queryKey: [RESOURCE, "ledger", query],
    enabled,
    queryFn: ({ signal }) =>
      apiRequest<LedgerResponse>(`/${RESOURCE}/ledger${toSearch(query)}`, {
        schema: ledgerResponseSchema,
        signal,
      }),
  });

/** Panel 1 — the payout summary, grouped by site and party. */
export const useBalances = (query: ReportQuery, enabled = true) =>
  useQuery({
    queryKey: [RESOURCE, "balances", query],
    enabled,
    queryFn: ({ signal }) =>
      apiRequest<BalancesResponse>(`/${RESOURCE}/balances${toSearch(query)}`, {
        schema: balancesResponseSchema,
        signal,
      }),
  });

/** `/Sales/SalesReport` — its own screen, its own right, the same aggregate. */
export const useSalesReport = (query: ReportQuery, enabled = true) =>
  useQuery({
    queryKey: [RESOURCE, "sales", query],
    enabled,
    queryFn: ({ signal }) =>
      apiRequest<BalancesResponse>(`/${RESOURCE}/sales${toSearch(query)}`, {
        schema: balancesResponseSchema,
        signal,
      }),
  });

/**
 * The report downloads.
 *
 * The filters go with the file, and `limit` and `offset` deliberately do not:
 * an export is the whole filtered set, so exporting from page 3 would produce a
 * file whose Total describes something other than its rows. The server refuses
 * paging parameters for the same reason.
 *
 * The legacy exports are POSTs with a JSON body, so none of them can be
 * bookmarked, re-run from history, or opened in a second tab. These are GETs
 * with the panel's own query string.
 */
type ExportKind = "ledger" | "balances" | "sales";

const EXPORT_PATH: Record<string, string> = {
  "ledger:xlsx": "ledger/export.xlsx",
  "ledger:pdf": "ledger/export.pdf",
  "ledger:by-party": "ledger/by-party.xlsx",
  "balances:xlsx": "balances/export.xlsx",
  "balances:pdf": "balances/export.pdf",
  "sales:xlsx": "sales/export.xlsx",
  "sales:pdf": "sales/export.pdf",
};

const EXPORT_NAME: Record<ExportKind, Parameters<typeof reportFileName>[0]> = {
  ledger: "Ledger",
  balances: "Balances",
  sales: "Sales-Report",
};

export async function downloadReport(
  kind: ExportKind,
  format: "xlsx" | "pdf" | "by-party",
  query: ReportQuery,
): Promise<void> {
  const path = EXPORT_PATH[`${kind}:${format}`]!;

  // Paging never travels with an export.
  const { limit: _limit, offset: _offset, ...filters } = query;
  const blob = await downloadRequest(`/${RESOURCE}/${path}${toSearch(filters)}`);

  const name =
    format === "by-party"
      ? reportFileName("Ledger-by-supplier", new Date(), "xlsx")
      : reportFileName(EXPORT_NAME[kind], new Date(), format);

  saveBlob(blob, name);
}
