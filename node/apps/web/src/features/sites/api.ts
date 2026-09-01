import { siteRowSchema, type SiteRow } from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";

export const useSiteList = (params: ListParams) =>
  useListResource<SiteRow>("sites", siteRowSchema, params);
