import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  purchaseRequestDetailSchema,
  purchaseRequestRowSchema,
  type CreatePurchaseRequest,
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
 * `useItemOptions` MOVED TO `features/items/api.ts`, where a hook that fetches
 * `/items` always belonged.
 *
 * It lived here because purchase requests were the first screen to need an item
 * dropdown, and five other modules then imported it from this file. That was
 * merely odd until the shared `ItemCombobox` was written: it lives in
 * `features/items`, so leaving the hook here would have had the items module
 * importing from purchase-requests while purchase-requests imported the control
 * back from items.
 */
