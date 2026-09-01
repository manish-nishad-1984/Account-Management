import { companyRowSchema, type CompanyRow } from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";

export const useCompanyList = (params: ListParams) =>
  useListResource<CompanyRow>("companies", companyRowSchema, params);
