import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inventoryInwardDetailSchema,
  inventoryInwardListResponseSchema,
  inventoryInwardRowSchema,
  type CreateInventoryInward,
  type InventoryInwardDetail,
  type InventoryInwardListResponse,
  type InventoryInwardRow,
  type UpdateInventoryInward,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";

const RESOURCE = "inventory-inward";

export type InventoryInwardFilters = ListFilters & {
  /** Omit to follow the application's site scope, which is the normal case. */
  siteId?: string;
  isApproved?: boolean;
};

/**
 * The site comes from the shell, exactly as it does for purchase requests —
 * `useScopedSiteId`, then `enabled: isReady`. See PLAN.md §1.1.
 *
 * The response is wider than the shared page shape by one field: `unallocated`,
 * the number of live rows with no site at all. Every row imported from
 * production is one, because the .NET form never set `SiteId`.
 */
export const useInventoryInwardList = (
  params: ListParams,
  filters: InventoryInwardFilters = {},
) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<InventoryInwardRow, InventoryInwardListResponse>(
    RESOURCE,
    inventoryInwardRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady, responseSchema: inventoryInwardListResponseSchema },
  );
};

export const useInventoryInward = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<InventoryInwardDetail>(`/${RESOURCE}/${id}`, {
        schema: inventoryInwardDetailSchema,
        signal,
      }),
  });

export const useCreateInventoryInward = () =>
  useCreateResource<CreateInventoryInward, InventoryInwardDetail>(
    RESOURCE,
    inventoryInwardDetailSchema,
  );

export const useUpdateInventoryInward = () =>
  useUpdateResource<UpdateInventoryInward, InventoryInwardDetail>(
    RESOURCE,
    inventoryInwardDetailSchema,
  );

export const useDeleteInventoryInward = () => useDeleteResource(RESOURCE);

/** Approval states the value it wants. `ApproveInventoryDetails` flips whatever is there. */
export const useSetInventoryApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<InventoryInwardDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: inventoryInwardDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};
