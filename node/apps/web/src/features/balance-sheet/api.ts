import { useQuery } from "@tanstack/react-query";
import {
  balanceSheetDetailSchema,
  balanceSheetResponseSchema,
  type BalanceSheetDetail,
  type BalanceSheetResponse,
} from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "balance-sheet";

export interface BalanceSheetFilters {
  siteId?: string;
  companyId?: string;
  fromDate?: string;
  toDate?: string;
}

/** A project's detail; a saved sheet may give income and invoices their own dates. */
export interface BalanceSheetDetailFilters extends Omit<BalanceSheetFilters, "siteId"> {
  incomeFrom?: string;
  incomeTo?: string;
  invoiceFrom?: string;
  invoiceTo?: string;
}

/** Only defined, non-empty values reach the URL. */
const toSearch = (filters: BalanceSheetFilters | BalanceSheetDetailFilters): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const useBalanceSheet = (filters: BalanceSheetFilters, enabled = true) =>
  useQuery({
    queryKey: [RESOURCE, filters],
    enabled,
    queryFn: ({ signal }) =>
      apiRequest<BalanceSheetResponse>(`/${RESOURCE}${toSearch(filters)}`, {
        schema: balanceSheetResponseSchema,
        signal,
      }),
  });

/** One project's income entries and suppliers, fetched when its row is opened. */
export const useBalanceSheetDetail = (siteId: string | null, filters: BalanceSheetDetailFilters) =>
  useQuery({
    queryKey: [RESOURCE, "site", siteId, filters],
    enabled: siteId !== null,
    queryFn: ({ signal }) =>
      apiRequest<BalanceSheetDetail>(`/${RESOURCE}/site/${siteId}${toSearch(filters)}`, {
        schema: balanceSheetDetailSchema,
        signal,
      }),
  });
