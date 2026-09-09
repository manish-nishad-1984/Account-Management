import { useQuery } from "@tanstack/react-query";
import {
  balancesResponseSchema,
  ledgerResponseSchema,
  type BalancesResponse,
  type LedgerResponse,
} from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";

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
