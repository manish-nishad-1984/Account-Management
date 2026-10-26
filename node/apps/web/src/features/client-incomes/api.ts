import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  clientIncomeDetailSchema,
  clientIncomeRowSchema,
  incomeImportPreviewSchema,
  incomeImportResultSchema,
  listResponseSchema,
  type IncomeImportPreview,
  type IncomeImportResult,
  type ClientIncomeDetail,
  type ClientIncomeRow,
  type CreateClientIncome,
  type UpdateClientIncome,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { useScopedSiteId } from "../../contexts/SiteScopeContext";
import { ApiError, apiRequest, uploadRequest } from "../../lib/api-client";

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

/** "Import income", step 1 (client, 26 Oct 2026): every row checked, nothing saved. */
export const usePreviewIncomeImport = () =>
  useMutation({
    mutationFn: ({ file }: { file: File }) =>
      uploadRequest<IncomeImportPreview>(`/${RESOURCE}/import/preview`, [file], { schema: incomeImportPreviewSchema }),
  });

/** Step 2: the same file with the count and total the person verified. */
export const useImportIncomes = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, count, total }: { file: File; count: number; total: string }) =>
      uploadRequest<IncomeImportResult>(`/${RESOURCE}/import?count=${count}&total=${encodeURIComponent(total)}`, [file], {
        schema: incomeImportResultSchema,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [RESOURCE] });
      // The income is on the balance sheet the import is opened from.
      client.invalidateQueries({ queryKey: ["balance-sheet"] });
    },
  });
};

/** The preview out of a refused import, or null when it failed some other way. */
export function incomeImportRejectionFrom(error: unknown): IncomeImportPreview | null {
  if (!(error instanceof ApiError) || !error.body) return null;
  const parsed = incomeImportPreviewSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}
