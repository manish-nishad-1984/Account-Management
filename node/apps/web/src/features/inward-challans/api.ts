import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inwardChallanDetailSchema,
  inwardChallanListResponseSchema,
  inwardChallanRowSchema,
  listResponseSchema,
  supplierRowSchema,
  type CreateInwardChallan,
  type InwardChallanDetail,
  type InwardChallanListResponse,
  type InwardChallanRow,
  type ListResponse,
  type SupplierRow,
  type UpdateInwardChallan,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";

const RESOURCE = "inward-challans";

export type ChallanFilters = ListFilters & {
  siteId?: string;
  supplierId?: string;
  itemId?: string;
  isApproved?: boolean;
  fromDate?: string;
  toDate?: string;
};

/**
 * The site comes from the shell. Same three lines as every scoped list.
 *
 * The response is wider than the shared page shape by `totalQuantity`, the
 * footer aggregate over the whole filtered set.
 */
export const useInwardChallanList = (params: ListParams, filters: ChallanFilters = {}) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<InwardChallanRow, InwardChallanListResponse>(
    RESOURCE,
    inwardChallanRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady, responseSchema: inwardChallanListResponseSchema },
  );
};

export const useInwardChallan = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<InwardChallanDetail>(`/${RESOURCE}/${id}`, {
        schema: inwardChallanDetailSchema,
        signal,
      }),
  });

export const useCreateInwardChallan = () =>
  useCreateResource<CreateInwardChallan, InwardChallanDetail>(RESOURCE, inwardChallanDetailSchema);

export const useUpdateInwardChallan = () =>
  useUpdateResource<UpdateInwardChallan, InwardChallanDetail>(RESOURCE, inwardChallanDetailSchema);

export const useDeleteInwardChallan = () => useDeleteResource(RESOURCE);

export const useSetChallanApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<InwardChallanDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: inwardChallanDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};

/**
 * Suppliers for the filter and the form.
 *
 * Capped at 200 like the item list. The legacy screen's Supplier box looks like
 * free text and is parsed with `Guid.Parse`, so typing a name there matches
 * nothing — a dropdown is what it always needed to be.
 */
export const useSupplierOptions = () =>
  useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<SupplierRow>>(`/suppliers?limit=200&sortBy=name`, {
        schema: listResponseSchema(supplierRowSchema) as never,
        signal,
      }),
  });
