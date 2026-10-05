import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  payoutListDetailSchema,
  payoutListRowSchema,
  payoutOutstandingResponseSchema,
  type CreatePayoutList,
  type PayoutListDetail,
  type PayoutListRow,
  type UpdatePayoutList,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "payout-lists";

/**
 * Every query here is keyed under `payout-lists`, so the shared write hooks
 * (which invalidate that prefix) also refresh the outstanding the builder shows.
 * A saved list does not change what is owed, but a list edited in one tab must
 * not leave the other tab building from yesterday's figures.
 */
export const usePayoutLists = (params: ListParams) =>
  useListResource<PayoutListRow>(RESOURCE, payoutListRowSchema, params);

const detailQuery = (id: string) => ({
  queryKey: [RESOURCE, "detail", id],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    apiRequest<PayoutListDetail>(`/${RESOURCE}/${id}`, { schema: payoutListDetailSchema, signal }),
});

export const usePayoutList = (id: string | null) =>
  useQuery({ ...detailQuery(id ?? ""), enabled: id !== null });

/**
 * The detail for sending, fetched on demand and warmed by a hover.
 *
 * A browser only lets `window.open` through inside the click that asked for it;
 * a click that first waits on the network can be taken for a pop-up and blocked.
 * Warming the cache as the pointer arrives makes the click itself synchronous in
 * practice; `fetch` is the fallback for a keyboard or touch user.
 */
export function usePayoutDetailLoader() {
  const queryClient = useQueryClient();
  return {
    cached: (id: string) => queryClient.getQueryData<PayoutListDetail>([RESOURCE, "detail", id]),
    prefetch: (id: string) => void queryClient.prefetchQuery({ ...detailQuery(id), staleTime: 30_000 }),
    fetch: (id: string) => queryClient.fetchQuery({ ...detailQuery(id), staleTime: 30_000 }),
  };
}

/**
 * Parties we owe, for the builder. Fetched fresh each time a form opens: a list
 * built five days after the last is built from what is owed NOW.
 */
export const usePayoutOutstanding = (enabled: boolean) =>
  useQuery({
    queryKey: [RESOURCE, "outstanding"],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      apiRequest(`/${RESOURCE}/outstanding`, { schema: payoutOutstandingResponseSchema, signal }),
  });

export const useCreatePayoutList = () =>
  useCreateResource<CreatePayoutList, PayoutListDetail>(RESOURCE, payoutListDetailSchema);
export const useUpdatePayoutList = () =>
  useUpdateResource<UpdatePayoutList, PayoutListDetail>(RESOURCE, payoutListDetailSchema);
export const useDeletePayoutList = () => useDeleteResource(RESOURCE);
