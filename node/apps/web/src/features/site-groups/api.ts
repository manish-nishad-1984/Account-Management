import { siteGroupRowSchema, type SiteGroupRow } from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";

export const useSiteGroupList = (params: ListParams) =>
  useListResource<SiteGroupRow>("site-groups", siteGroupRowSchema, params);
