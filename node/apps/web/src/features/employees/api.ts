import { useQuery } from "@tanstack/react-query";
import {
  employeeDetailSchema,
  employeeRowSchema,
  type CreateEmployee,
  type EmployeeDetail,
  type EmployeeRow,
  type UpdateEmployee,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "employees";

export const useEmployeeList = (params: ListParams, filters: ListFilters = {}) =>
  useListResource<EmployeeRow>(RESOURCE, employeeRowSchema, params, filters);

export const useEmployee = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) => apiRequest<EmployeeDetail>(`/${RESOURCE}/${id}`, { schema: employeeDetailSchema, signal }),
  });

export const useCreateEmployee = () => useCreateResource<CreateEmployee, EmployeeDetail>(RESOURCE, employeeDetailSchema);
export const useUpdateEmployee = () => useUpdateResource<UpdateEmployee, EmployeeDetail>(RESOURCE, employeeDetailSchema);
export const useDeleteEmployee = () => useDeleteResource(RESOURCE);
