import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  itemRowSchema,
  listResponseSchema,
  purchaseRequestDetailSchema,
  purchaseRequestRowSchema,
  type CreatePurchaseRequest,
  type ItemRow,
  type ListResponse,
  type PurchaseRequestDetail,
  type PurchaseRequestRow,
  type UpdatePurchaseRequest,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "purchase-requests";

export type PurchaseRequestFilters = ListFilters & {
  /** Omit to follow the application's site scope, which is the normal case. */
  siteId?: string;
  isApproved?: boolean;
};

/**
 * The site comes from the SHELL, not from this screen.
 *
 * Every legacy screen is filtered by the header's `drpSiteName` rather than by a
 * dropdown of its own, and this is the worked example of that here: a scoped
 * list hook reads `useScopedSiteId`, passes the result as a filter, and gates
 * the request on `isReady`. Each module that lands copies these three lines.
 */
export const usePurchaseRequestList = (params: ListParams, filters: PurchaseRequestFilters = {}) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<PurchaseRequestRow>(
    RESOURCE,
    purchaseRequestRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady },
  );
};

export const usePurchaseRequest = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<PurchaseRequestDetail>(`/${RESOURCE}/${id}`, {
        schema: purchaseRequestDetailSchema,
        signal,
      }),
  });

export const useCreatePurchaseRequest = () =>
  useCreateResource<CreatePurchaseRequest, PurchaseRequestDetail>(
    RESOURCE,
    purchaseRequestDetailSchema,
  );

export const useUpdatePurchaseRequest = () =>
  useUpdateResource<UpdatePurchaseRequest, PurchaseRequestDetail>(
    RESOURCE,
    purchaseRequestDetailSchema,
  );

export const useDeletePurchaseRequest = () => useDeleteResource(RESOURCE);

/**
 * Approval is a PATCH to a sub-resource with the value stated, not a toggle.
 *
 * The old screen posted "flip this one", so clicking twice quickly could land in
 * either state and two approvers racing produced whichever ordering won. Sending
 * the intended value means a repeat is a no-op rather than a reversal.
 */
export const useSetApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<PurchaseRequestDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: purchaseRequestDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};

/*
 * There is no `useAllSites` here any more.
 *
 * It read `GET /sites`, which requires the `site.view` right — the one that
 * guards the Site MASTER screen. A user who may raise purchase requests but not
 * administer sites got a 403 and an empty dropdown. Both the filter and the
 * form now read `useSiteScope`, which is fed by `/sites/assignable`: no right
 * required, and scoped to the sites that user actually works on.
 */

/**
 * Every item, for the item dropdown.
 *
 * 758 items in production, which is over the 200-row cap — so this is the first
 * dropdown in the app that CANNOT show everything. It loads the first page for
 * the common case and the form falls back to free text, which the document
 * supports natively (`item_name`). A search-as-you-type control replaces this
 * when the item list is next touched; the cap is stated in the form so the
 * limitation is visible rather than silent.
 */
export const useItemOptions = (search: string) =>
  useQuery({
    queryKey: ["items", "options", search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: "200", sortBy: "name" });
      if (search.trim()) params.set("search", search.trim());
      return apiRequest<ListResponse<ItemRow>>(`/items?${params.toString()}`, {
        schema: listResponseSchema(itemRowSchema) as never,
        signal,
      });
    },
  });
