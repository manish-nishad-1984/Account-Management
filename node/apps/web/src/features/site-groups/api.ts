import { useQuery } from "@tanstack/react-query";
import {
  siteGroupDetailSchema,
  siteGroupRowSchema,
  type CreateSiteGroup,
  type SiteGroupDetail,
  type SiteGroupRow,
  type UpdateSiteGroup,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "site-groups";

export const useSiteGroupList = (params: ListParams) =>
  useListResource<SiteGroupRow>(RESOURCE, siteGroupRowSchema, params);

export const useSiteGroup = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<SiteGroupDetail>(`/${RESOURCE}/${id}`, {
        schema: siteGroupDetailSchema,
        signal,
      }),
  });

export const useCreateSiteGroup = () =>
  useCreateResource<CreateSiteGroup, SiteGroupDetail>(RESOURCE, siteGroupDetailSchema);

export const useUpdateSiteGroup = () =>
  useUpdateResource<UpdateSiteGroup, SiteGroupDetail>(RESOURCE, siteGroupDetailSchema);

export const useDeleteSiteGroup = () => useDeleteResource(RESOURCE);
