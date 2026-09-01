import { useQuery } from "@tanstack/react-query";
import {
  siteDetailSchema,
  siteRowSchema,
  type CreateSite,
  type SiteDetail,
  type SiteRow,
  type UpdateSite,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

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
