import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  salesInvoiceDetailSchema,
  salesInvoiceRowSchema,
  type CreateSalesInvoice,
  type SalesInvoiceDetail,
  type SalesInvoiceRow,
  type UpdateSalesInvoice,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "sales-invoices";

export type SalesInvoiceFilters = ListFilters & {
  siteId?: string;
  companyId?: string;
  customerId?: string;
  invoiceType?: string;
  isApproved?: boolean;
};

export const useSalesInvoiceList = (params: ListParams, filters: SalesInvoiceFilters = {}) => {
  const { siteId, isReady } = useScopedSiteId(filters.siteId);
  return useListResource<SalesInvoiceRow>(
    RESOURCE,
    salesInvoiceRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady },
  );
};

export const useSalesInvoice = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<SalesInvoiceDetail>(`/${RESOURCE}/${id}`, {
        schema: salesInvoiceDetailSchema,
        signal,
      }),
  });

export const useCreateSalesInvoice = () =>
  useCreateResource<CreateSalesInvoice, SalesInvoiceDetail>(RESOURCE, salesInvoiceDetailSchema);

export const useUpdateSalesInvoice = () =>
  useUpdateResource<UpdateSalesInvoice, SalesInvoiceDetail>(RESOURCE, salesInvoiceDetailSchema);

export const useDeleteSalesInvoice = () => useDeleteResource(RESOURCE);

/** States the approval rather than toggling it — see purchase requests. */
export const useSetApproval = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiRequest<SalesInvoiceDetail>(`/${RESOURCE}/${id}/approval`, {
        method: "PATCH",
        body: { isApproved },
        schema: salesInvoiceDetailSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [RESOURCE] }),
  });
};

/**
 * Customers, for the counterparty dropdown.
 *
 * There is no customer endpoint because there is no customer TABLE — the source
 * keeps both sides of the trade in `SupplierMaster`, so this is the suppliers
 * list under the name it has on this screen. Re-exported here rather than
 * imported from the purchase feature so the sales screens never read as though
 * they bill a supplier.
 */
export { useSupplierOptions as useCustomerOptions, useCompanyOptions } from "../purchase-orders/api";
