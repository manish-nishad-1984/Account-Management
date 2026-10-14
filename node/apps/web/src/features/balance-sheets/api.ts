import { useMutation, useQuery } from "@tanstack/react-query";
import {
  balanceSheetPreviewSchema,
  savedBalanceSheetDetailSchema,
  savedBalanceSheetRowSchema,
  type BalanceSheetPreview,
  type CreateBalanceSheet,
  type SavedBalanceSheetDetail,
  type SavedBalanceSheetRow,
  type UpdateBalanceSheet,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "balance-sheets";

export const useSavedBalanceSheets = (params: ListParams, filters: ListFilters = {}) =>
  useListResource<SavedBalanceSheetRow>(RESOURCE, savedBalanceSheetRowSchema, params, filters);

export const useSavedBalanceSheet = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<SavedBalanceSheetDetail>(`/${RESOURCE}/${id}`, { schema: savedBalanceSheetDetailSchema, signal }),
  });

/** The sheet as it would be worked out now. Nothing is saved. */
export const usePreviewBalanceSheet = () =>
  useMutation({
    mutationFn: (body: CreateBalanceSheet) =>
      apiRequest<BalanceSheetPreview>(`/${RESOURCE}/preview`, { method: "POST", body, schema: balanceSheetPreviewSchema }),
  });

export const useCreateBalanceSheet = () =>
  useCreateResource<CreateBalanceSheet, SavedBalanceSheetDetail>(RESOURCE, savedBalanceSheetDetailSchema);
export const useUpdateBalanceSheet = () =>
  useUpdateResource<UpdateBalanceSheet, SavedBalanceSheetDetail>(RESOURCE, savedBalanceSheetDetailSchema);
export const useDeleteBalanceSheet = () => useDeleteResource(RESOURCE);
