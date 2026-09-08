import { useQuery } from "@tanstack/react-query";
import {
  supplierDetailSchema,
  supplierRowSchema,
  type CreateSupplier,
  type SupplierDetail,
  type SupplierRow,
  type UpdateSupplier,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "suppliers";

/** `isApproved: false` is the dashboard's pending queue; the list screen passes nothing. */
export type SupplierFilters = ListFilters & { isApproved?: boolean };

export const useSupplierList = (params: ListParams, filters: SupplierFilters = {}) =>
  useListResource<SupplierRow>(RESOURCE, supplierRowSchema, params, filters);

/** Bank details are not on the list row, so editing needs the full record. */
export const useSupplier = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<SupplierDetail>(`/${RESOURCE}/${id}`, { schema: supplierDetailSchema, signal }),
  });

export const useCreateSupplier = () =>
  useCreateResource<CreateSupplier, SupplierDetail>(RESOURCE, supplierDetailSchema);

export const useUpdateSupplier = () =>
  useUpdateResource<UpdateSupplier, SupplierDetail>(RESOURCE, supplierDetailSchema);

export const useDeleteSupplier = () => useDeleteResource(RESOURCE);
