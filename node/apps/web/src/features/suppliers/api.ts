import { useQuery } from "@tanstack/react-query";
import {
  supplierDetailSchema,
  supplierRowSchema,
  type CreateSupplier,
  type SupplierDetail,
  type SupplierRow,
  type UpdateSupplier,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "suppliers";

export const useSupplierList = (params: ListParams) =>
  useListResource<SupplierRow>(RESOURCE, supplierRowSchema, params);

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
