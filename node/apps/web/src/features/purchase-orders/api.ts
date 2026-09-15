import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  companyRowSchema,
  listResponseSchema,
  purchaseOrderDetailSchema,
  purchaseOrderRowSchema,
  supplierRowSchema,
  type CompanyRow,
  type CreatePurchaseOrder,
  type ListResponse,
  type PurchaseOrderDetail,
  type PurchaseOrderRow,
  type SupplierRow,
  type UpdatePurchaseOrder,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "purchase-orders";

export type PurchaseOrderFilters = ListFilters & {
  siteId?: string;
  isApproved?: boolean;
  isActive?: boolean;
};

/** Site-scoped, exactly as `usePurchaseRequestList` is. See the note there. */
export const usePurchaseOrderList = (params: ListParams, filters: PurchaseOrderFilters = {}) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<PurchaseOrderRow>(
    RESOURCE,
    purchaseOrderRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady },
  );
};

export const usePurchaseOrder = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<PurchaseOrderDetail>(`/${RESOURCE}/${id}`, {
        schema: purchaseOrderDetailSchema,
        signal,
      }),
  });

export const useCreatePurchaseOrder = () =>
  useCreateResource<CreatePurchaseOrder, PurchaseOrderDetail>(RESOURCE, purchaseOrderDetailSchema);

export const useUpdatePurchaseOrder = () =>
  useUpdateResource<UpdatePurchaseOrder, PurchaseOrderDetail>(RESOURCE, purchaseOrderDetailSchema);

export const useDeletePurchaseOrder = () => useDeleteResource(RESOURCE);

/** States the approval rather than toggling it — see purchase requests. */
export const useSetApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<PurchaseOrderDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: purchaseOrderDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};

/**
 * Suppliers for the Supplier Details panel.
 *
 * 171 in production, inside the 200 cap — unlike items, which are not. If that
 * grows past 200 this becomes the same silent truncation the item dropdown has,
 * so the cap is stated here rather than assumed away.
 */
export const useSupplierOptions = () =>
  useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<SupplierRow>>("/suppliers?limit=200&sortBy=name", {
        schema: listResponseSchema(supplierRowSchema) as never,
        signal,
      }),
  });

/**
 * Companies, for the panel that decides the ORDER NUMBER's prefix.
 *
 * This dropdown is not cosmetic: `purchase_orders.po_no` is issued per company
 * from that company's `invoice_prefix`, so choosing here picks which sequence the
 * order is drawn from. A company with no prefix cannot be numbered and the server
 * refuses it by name.
 */
export const useCompanyOptions = () =>
  useQuery({
    queryKey: ["companies", "options"],
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<CompanyRow>>("/companies?limit=200&sortBy=name", {
        schema: listResponseSchema(companyRowSchema) as never,
        signal,
      }),
  });
