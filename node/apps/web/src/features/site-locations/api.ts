import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  siteLocationDetailSchema,
  siteLocationRowSchema,
  siteLocationSheetResultSchema,
  type CreateSiteLocations,
  type SaveSiteLocations,
  type SiteLocationDetail,
  type SiteLocationRow,
  type SiteLocationSheetResult,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useDeleteResource } from "../../lib/crud";
import { ApiError, apiRequest, uploadRequest } from "../../lib/api-client";

const RESOURCE = "site-locations";

export const useSiteLocationList = (params: ListParams) =>
  useListResource<SiteLocationRow>(RESOURCE, siteLocationRowSchema, params);

/** A site's locations and addresses. Addressed by SITE id. */
export const useSiteLocations = (siteId: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", siteId],
    enabled: siteId !== null,
    queryFn: ({ signal }) =>
      apiRequest<SiteLocationDetail>(`/${RESOURCE}/${siteId}`, {
        schema: siteLocationDetailSchema,
        signal,
      }),
  });

/**
 * Create or update, as one mutation.
 *
 * Which it is depends on whether the site ALREADY has an entry, which the form
 * learns only after a site is picked — so the caller says, rather than holding
 * two mutation objects. Both invalidate the site's document options as well as
 * this screen's list: the addresses saved here are shipping choices on every
 * order and invoice for that site.
 */
export function useSaveSiteLocations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      siteId,
      exists,
      body,
    }: {
      siteId: string;
      exists: boolean;
      body: SaveSiteLocations;
    }) =>
      exists
        ? apiRequest<SiteLocationDetail>(`/${RESOURCE}/${siteId}`, {
            method: "PATCH",
            body,
            schema: siteLocationDetailSchema,
          })
        : apiRequest<SiteLocationDetail>(`/${RESOURCE}`, {
            method: "POST",
            body: { siteId, ...body } satisfies CreateSiteLocations,
            schema: siteLocationDetailSchema,
          }),
    onSuccess: (_saved, variables) => {
      void queryClient.invalidateQueries({ queryKey: [RESOURCE] });
      void queryClient.invalidateQueries({
        queryKey: ["sites", "document-options", variables.siteId],
      });
    },
  });
}

export const useDeleteSiteLocations = () => useDeleteResource(RESOURCE);

/**
 * "Import locations": a spreadsheet of locations and their addresses for ONE
 * site. A rejected file is a 400 whose body IS the result (every bad row), so the
 * dialog reads `error.body`; the mutation still throws.
 */
export const useImportSiteLocations = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, siteId }: { file: File; siteId: string }) =>
      uploadRequest<SiteLocationSheetResult>(`/${RESOURCE}/import?siteId=${siteId}`, [file], {
        schema: siteLocationSheetResultSchema,
      }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: [RESOURCE] });
      void queryClient.invalidateQueries({ queryKey: ["sites", "document-options", variables.siteId] });
    },
  });
};

/** The rejected result out of a failed import, or null when it failed some other way. */
export function siteLocationImportRejectionFrom(error: unknown): SiteLocationSheetResult | null {
  if (!(error instanceof ApiError) || !error.body) return null;
  const parsed = siteLocationSheetResultSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}
