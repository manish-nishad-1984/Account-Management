import { useQuery } from "@tanstack/react-query";
import {
  companyDetailSchema,
  companyRowSchema,
  type CompanyDetail,
  type CompanyRow,
  type CreateCompany,
  type UpdateCompany,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "companies";

export const useCompanyList = (params: ListParams) =>
  useListResource<CompanyRow>(RESOURCE, companyRowSchema, params);

/**
 * The full record, fetched only when the edit form opens.
 *
 * The list deliberately withholds the bank account number and IFSC, so editing
 * costs a second request — which is the point, not an oversight. `enabled` keeps
 * it from firing while nothing is being edited.
 */
export const useCompany = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<CompanyDetail>(`/${RESOURCE}/${id}`, { schema: companyDetailSchema, signal }),
  });

export const useCreateCompany = () =>
  useCreateResource<CreateCompany, CompanyDetail>(RESOURCE, companyDetailSchema);

export const useUpdateCompany = () =>
  useUpdateResource<UpdateCompany, CompanyDetail>(RESOURCE, companyDetailSchema);

export const useDeleteCompany = () => useDeleteResource(RESOURCE);
