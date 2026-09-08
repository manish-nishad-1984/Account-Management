import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listResponseSchema,
  purchaseInvoiceDetailSchema,
  purchaseInvoiceRowSchema,
  purchaseOrderRowSchema,
  type CreatePurchaseInvoice,
  type ListResponse,
  type PurchaseInvoiceDetail,
  type PurchaseInvoiceRow,
  type PurchaseOrderRow,
  type UpdatePurchaseInvoice,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "purchase-invoices";

export type PurchaseInvoiceFilters = ListFilters & {
  siteId?: string;
  companyId?: string;
  supplierId?: string;
  invoiceType?: string;
  isApproved?: boolean;
};

/** Site-scoped, exactly as the purchase order list is. See the note there. */
export const usePurchaseInvoiceList = (
  params: ListParams,
  filters: PurchaseInvoiceFilters = {},
) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<PurchaseInvoiceRow>(
    RESOURCE,
    purchaseInvoiceRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady },
  );
};

export const usePurchaseInvoice = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<PurchaseInvoiceDetail>(`/${RESOURCE}/${id}`, {
        schema: purchaseInvoiceDetailSchema,
        signal,
      }),
  });

export const useCreatePurchaseInvoice = () =>
  useCreateResource<CreatePurchaseInvoice, PurchaseInvoiceDetail>(
    RESOURCE,
    purchaseInvoiceDetailSchema,
  );

export const useUpdatePurchaseInvoice = () =>
  useUpdateResource<UpdatePurchaseInvoice, PurchaseInvoiceDetail>(
    RESOURCE,
    purchaseInvoiceDetailSchema,
  );

export const useDeletePurchaseInvoice = () => useDeleteResource(RESOURCE);

/** States the approval rather than toggling it — see purchase requests. */
export const useSetApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<PurchaseInvoiceDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: purchaseInvoiceDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};

/**
 * Purchase orders, for the "bills against" dropdown.
 *
 * Scoped to the chosen supplier, because an invoice bills an order the SAME
 * supplier raised — offering all of them would invite the mismatch the legacy
 * text match makes silently. Disabled until a supplier is chosen, rather than
 * listing everything and hoping.
 *
 * The 200 cap is the API's hard limit; a supplier with more open orders than
 * that would truncate, and the field is optional free choice rather than the
 * only way to record the link, so truncation degrades rather than blocks.
 */
export const usePurchaseOrderOptions = (supplierId: string | null) =>
  useQuery({
    queryKey: ["purchase-orders", "options", supplierId],
    enabled: supplierId !== null && supplierId !== "",
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<PurchaseOrderRow>>(
        `/purchase-orders?limit=200&sortBy=poNo&sortDir=desc&supplierId=${supplierId}`,
        { schema: listResponseSchema(purchaseOrderRowSchema) as never, signal },
      ),
  });
