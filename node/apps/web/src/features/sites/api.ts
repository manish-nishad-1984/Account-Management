import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addressChoicesResponseSchema,
  siteAddressSchema,
  siteAddressesResponseSchema,
  siteDetailSchema,
  siteRowSchema,
  type AddressChoicesResponse,
  type CreateSite,
  type SiteAddress,
  type SiteAddressesResponse,
  type SiteDetail,
  type SiteRow,
  type UpdateSite,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest, deleteRequest } from "../../lib/api-client";

const RESOURCE = "sites";

export const useSiteList = (params: ListParams) =>
  useListResource<SiteRow>(RESOURCE, siteRowSchema, params);

export const useSite = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<SiteDetail>(`/${RESOURCE}/${id}`, { schema: siteDetailSchema, signal }),
  });

export const useCreateSite = () => useCreateResource<CreateSite, SiteDetail>(RESOURCE, siteDetailSchema);

export const useUpdateSite = () => useUpdateResource<UpdateSite, SiteDetail>(RESOURCE, siteDetailSchema);

export const useDeleteSite = () => useDeleteResource(RESOURCE);

/**
 * A SITE'S DELIVERY ADDRESSES, and what a document offers for one.
 *
 * Two hooks rather than one, because they answer to different people. The first
 * is the site master's editor and needs `site.view`; the second is a dropdown on
 * an invoice, is deliberately unguarded on the server, and returns lines of text
 * and nothing else.
 */

export const useSiteAddresses = (siteId: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "addresses", siteId],
    enabled: siteId !== null,
    queryFn: ({ signal }) =>
      apiRequest<SiteAddressesResponse>(`/${RESOURCE}/${siteId}/addresses`, {
        schema: siteAddressesResponseSchema,
        signal,
      }).then((response) => response.rows),
  });

export const useAddressChoices = (siteId: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "address-choices", siteId],
    enabled: siteId !== null && siteId !== "",
    queryFn: ({ signal }) =>
      apiRequest<AddressChoicesResponse>(`/${RESOURCE}/${siteId}/address-choices`, {
        schema: addressChoicesResponseSchema,
        signal,
      }).then((response) => response.rows),
  });

/**
 * The three writes, as one hook.
 *
 * The site form saves a whole list at once — some rows added, some edited, some
 * removed — so a caller that had to assemble three mutation objects and keep
 * their pending states in step would be doing bookkeeping the form should not
 * carry. `saveAddresses` below does the diff; these are the requests it sends.
 */
export function useSiteAddressWrites() {
  const queryClient = useQueryClient();
  const invalidate = (siteId: string) =>
    queryClient.invalidateQueries({ queryKey: [RESOURCE, "addresses", siteId] });

  return useMutation({
    mutationFn: async ({
      siteId,
      existing,
      next,
    }: {
      siteId: string;
      existing: SiteAddress[];
      next: AddressDraft[];
    }) => {
      await saveAddresses(siteId, existing, next);
    },
    onSuccess: (_result, variables) => {
      void invalidate(variables.siteId);
      void queryClient.invalidateQueries({
        queryKey: [RESOURCE, "address-choices", variables.siteId],
      });
    },
  });
}

/** One line as the form holds it: an id once it has been saved, text always. */
export interface AddressDraft {
  id: number | null;
  address: string;
}

/**
 * Bring the stored list in line with the edited one.
 *
 * SEQUENTIAL, not `Promise.all`. These are a handful of rows at most and the
 * order they are applied in is the order they were edited in, which is what the
 * list shows afterwards — `site_addresses` has no sort field but its id, so a
 * parallel insert would make the order depend on which request the server
 * happened to finish first.
 *
 * A row whose text has not changed is not written at all. Saving a site after
 * editing only its name should not touch four address rows.
 */
export async function saveAddresses(
  siteId: string,
  existing: SiteAddress[],
  next: AddressDraft[],
): Promise<void> {
  const kept = new Set(next.map((draft) => draft.id).filter((id): id is number => id !== null));

  for (const row of existing) {
    if (!kept.has(row.id)) {
      await deleteRequest(`/${RESOURCE}/${siteId}/addresses/${row.id}`);
    }
  }

  for (const draft of next) {
    const address = draft.address.trim();
    if (address === "") continue;

    if (draft.id === null) {
      await apiRequest(`/${RESOURCE}/${siteId}/addresses`, {
        method: "POST",
        body: { address },
        schema: siteAddressSchema,
      });
      continue;
    }

    const before = existing.find((row) => row.id === draft.id);
    if (before && before.address === address) continue;

    await apiRequest(`/${RESOURCE}/${siteId}/addresses/${draft.id}`, {
      method: "PATCH",
      body: { address },
      schema: siteAddressSchema,
    });
  }
}
