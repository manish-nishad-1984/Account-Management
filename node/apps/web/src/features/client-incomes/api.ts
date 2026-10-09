import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  clientIncomeDetailSchema,
  clientIncomeRowSchema,
  listResponseSchema,
  type ClientIncomeDetail,
  type ClientIncomeRow,
  type CreateClientIncome,
  type UpdateClientIncome,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "client-incomes";

/** The list, and the Final Totals of everything the filters match, for its summary. */
const incomeListSchema = listResponseSchema(clientIncomeRowSchema).extend({ totalAmount: z.string() });
type IncomeListResponse = z.infer<typeof incomeListSchema>;

export type ClientIncomeFilters = ListFilters & { companyId?: string; clientId?: string };

/** Held to the header's project, like the other site-scoped lists. */
export const useClientIncomeList = (params: ListParams, filters: ClientIncomeFilters = {}) => {
  const { siteId, isReady } = useScopedSiteId();
  return useListResource<ClientIncomeRow, IncomeListResponse>(
    RESOURCE,
    clientIncomeRowSchema,
    params,
    { ...filters, siteId },
    { enabled: isReady, responseSchema: incomeListSchema as never },
  );
};

export const useClientIncome = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<ClientIncomeDetail>(`/${RESOURCE}/${id}`, { schema: clientIncomeDetailSchema, signal }),
  });

export const useCreateClientIncome = () =>
  useCreateResource<CreateClientIncome, ClientIncomeDetail>(RESOURCE, clientIncomeDetailSchema);
export const useUpdateClientIncome = () =>
  useUpdateResource<UpdateClientIncome, ClientIncomeDetail>(RESOURCE, clientIncomeDetailSchema);
export const useDeleteClientIncome = () => useDeleteResource(RESOURCE);
