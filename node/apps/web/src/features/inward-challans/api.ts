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
import { apiRequest, deleteRequest, downloadRequest, uploadRequest } from "../../lib/api-client";
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
 * Attaches files to an existing challan.
 *
 * The whole challan comes back rather than the new attachments alone, so the
 * detail cache holds one consistent object and cannot show a fresh document list
 * beside stale challan fields.
 */
export const useAttachChallanDocuments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, files }: { id: string; files: File[] }) =>
      uploadRequest<InwardChallanDetail>(`/${RESOURCE}/${id}/documents`, files, {
        schema: inwardChallanDetailSchema,
      }),
    onSuccess: (detail) => {
      client.setQueryData([RESOURCE, "detail", detail.id], detail);
      // The list shows a document COUNT, so it is stale too.
      client.invalidateQueries({ queryKey: [RESOURCE] });
    },
  });
};

export const useDetachChallanDocument = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, documentId }: { id: string; documentId: string }) =>
      deleteRequest(`/${RESOURCE}/${id}/documents/${documentId}`),
    onSuccess: (_result, { id }) => {
      client.invalidateQueries({ queryKey: [RESOURCE, "detail", id] });
      client.invalidateQueries({ queryKey: [RESOURCE] });
    },
  });
};

/**
 * Downloads one attachment and hands it to the browser.
 *
 * The object URL is revoked on the next tick. Without that every download leaks
 * its blob for the life of the page, which on a screen where someone opens
 * twenty scans is a hundred megabytes that never comes back.
 */
export async function downloadChallanDocument(
  id: string,
  documentId: string,
  fileName: string,
): Promise<void> {
  const blob = await downloadRequest(`/${RESOURCE}/${id}/documents/${documentId}`);
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
